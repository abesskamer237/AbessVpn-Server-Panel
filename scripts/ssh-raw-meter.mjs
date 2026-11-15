/** Raw HTTP-upgrade SSH relay. PAM admits the authenticated Linux identity
 * before SSH authentication succeeds; every subsequent byte is reserved in
 * the durable shared licence ledger BEFORE it crosses the relay. */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import {Transform} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {QuotaLedger} from './ssh-ws-quota.mjs';

export async function startRawMeter(options={}){
  const host=options.host??process.env.RAW_METER_HOST??'172.18.0.1';
  const port=Number(options.port??process.env.RAW_METER_PORT??8081);
  const sshPort=Number(options.sshPort??process.env.RAW_METER_SSH_PORT??22);
  const directory=options.directory??process.env.RAW_METER_DATA??'/var/lib/abess-raw-meter';
  const controlSocket=options.controlSocket??process.env.RAW_METER_CONTROL??'/run/abess-raw-meter/control.sock';
  const policyFile=options.policyFile??process.env.RAW_METER_POLICY??'/var/lib/abess-ssh-ws/policy/gateway-policy.json';
  const activeFile=options.activeFile??process.env.RAW_METER_ACTIVE??'/var/lib/abess-raw-meter/enabled';
  if(!['127.0.0.1','172.18.0.1'].includes(host)||![port,sshPort].every(p=>Number.isInteger(p)&&p>=0&&p<=65535))throw Error('Invalid relay address');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const ledger=new QuotaLedger({usageFile:path.join(directory,'usage.json'),reportFile:path.join(directory,'usage-live.json'),reservationBytes:1048576});
  const sessions=new Set(),byPeer=new Map();let wss;
  let valid=false,previous=null,deniedTotal=0,closed=false;
  const active=()=>fs.existsSync(activeFile);
  function publishAdmissions(){
    const file=path.join(directory,'admitted.json');
    fs.writeFileSync(file+'.tmp',JSON.stringify({observedAt:new Date().toISOString(),peers:[...sessions].filter(s=>s.id&&!s.released).map(s=>s.peer)}),{mode:0o600});fs.renameSync(file+'.tmp',file);
  }
  function refresh(){
    try{const raw=fs.readFileSync(policyFile,'utf8');if(raw!==previous){ledger.setPolicy(JSON.parse(raw));previous=raw;}valid=Boolean(ledger.policy&&Date.now()-ledger.policy.generatedAt<60000);}catch{valid=false;}
    const counts=new Map();
    for(const s of sessions){
      if(!s.id)continue;
      const p=ledger.policy?.accounts.find(a=>a.id===s.id);
      const count=(counts.get(s.id)||0)+1;counts.set(s.id,count);
      if(!valid||!active()||!ledger.authorized(s.id)||(p?.blockedDevices||[]).includes(s.deviceKey)||count>p.maxConnections)s.kill();
    }
  }
  refresh();
  function health(){return {ok:valid&&active(),format:'abess-raw-meter-v1',strict:true,policyReady:valid,active:active(),connections:sessions.size,authenticated:[...sessions].filter(s=>s.id).length,deniedTotal};}
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET'&&req.url==='/healthz')res.writeHead(200).end(JSON.stringify(health()));else res.writeHead(404).end('{}');
  });
  server.headersTimeout=10000;server.requestTimeout=15000;server.maxHeadersCount=40;
  server.on('clientError',(_e,socket)=>socket.destroy());
  function relayConnection(req,socket,head,raw=true){
    refresh();
    if(!valid||!active()||req.method!=='GET'||String(req.url).length>2048||sessions.size>=10000){if(raw)socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');else socket.destroy();return;}
    const upstream=net.createConnection({host:'127.0.0.1',port:sshPort});
    const s={id:null,deviceKey:null,upstream,socket,preauthBytes:0,released:false,meta:{
      ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,80),
      userAgent:String(req.headers['user-agent']||'').slice(0,160),name:String(req.headers['x-abess-device-name']||'').slice(0,80),brand:String(req.headers['x-abess-device-brand']||'').slice(0,80),
      rawId:String(req.headers['x-abess-device-id']||'').trim()
    }};
    s.kill=()=>{socket.destroy();upstream.destroy();};
    const release=()=>{if(s.released)return;s.released=true;clearTimeout(s.timer);sessions.delete(s);if(s.peer)byPeer.delete(s.peer);if(s.id){ledger.stop(s.id,s.deviceKey);publishAdmissions();}};
    s.timer=setTimeout(s.kill,30000);s.timer.unref();sessions.add(s);
    const meter=direction=>new Transform({highWaterMark:65536,transform(chunk,_encoding,callback){
      try{
        if(!Buffer.isBuffer(chunk)||chunk.length>65536){s.kill();callback();return;}
        if(!s.id){s.preauthBytes+=chunk.length;if(s.preauthBytes>65536){s.kill();callback();return;}callback(null,chunk);return;}
        if(!active()||!valid){s.kill();callback();return;}
        const take=ledger.consume(s.id,chunk.length,s.deviceKey,direction);
        if(take===chunk.length){callback(null,chunk);return;}
        if(take>0)this.push(chunk.subarray(0,take));s.kill();callback();
      }catch{s.kill();callback();}
    }});
    for(const stream of [socket,upstream]){stream.setNoDelay?.(true);stream.setKeepAlive?.(true,30000);stream.on('error',s.kill);stream.on('close',()=>{s.kill();release();});}
    req.socket.setNoDelay(true);req.socket.setKeepAlive(true,30000);
    upstream.once('connect',()=>{
      s.peer=upstream.localAddress+':'+upstream.localPort;byPeer.set(s.peer,s);
      if(raw)socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      const up=meter('up'),down=meter('down');up.on('error',s.kill);down.on('error',s.kill);
      if(head.length)up.write(head);
      socket.pipe(up).pipe(upstream);upstream.pipe(down).pipe(socket);
    });
  }
  server.on('upgrade',(req,socket,head)=>{
    if(!req.headers['sec-websocket-key']){relayConnection(req,socket,head);return;}
    try{
      let ws;
      try{ws=createRequire(import.meta.url)('ws');}catch{ws=createRequire('/opt/abess-panel/package.json')('ws');}
      wss??=new ws.WebSocketServer({noServer:true,perMessageDeflate:false,maxPayload:65536});
      wss.handleUpgrade(req,socket,head,client=>relayConnection(req,ws.createWebSocketStream(client,{highWaterMark:65536}),Buffer.alloc(0),false));
    }catch{socket.destroy();}
  });
  fs.mkdirSync(path.dirname(controlSocket),{recursive:true,mode:0o700});
  try{const st=fs.lstatSync(controlSocket);if(!st.isSocket()||st.uid!==process.getuid())throw Error('Unsafe control socket');fs.unlinkSync(controlSocket);}catch(e){if(e.code!=='ENOENT')throw e;}
  const control=net.createServer(socket=>{
    let data='';socket.setTimeout(3000,()=>socket.destroy());socket.on('error',()=>{});
    socket.on('data',chunk=>{
      data+=chunk;if(data.length>4096){socket.destroy();return;}if(!data.includes('\n'))return;
      let ok=false;
      try{
        const r=JSON.parse(data.split('\n')[0]);
        const s=byPeer.get(String(r.peerAddress)+':'+Number(r.peerPort));
        refresh();
        const p=ledger.policy?.accounts.find(a=>a.username===r.username);
        if(valid&&active()&&r.version===1&&r.serverAddress==='127.0.0.1'&&r.serverPort===sshPort&&s&&!s.released&&p){
          if(s.id)ok=s.id===p.id;
          else{
            const declared=/^[A-Za-z0-9._:-]{8,128}$/.test(s.meta.rawId);
            s.deviceKey=declared?crypto.createHash('sha256').update(p.id+'|'+s.meta.rawId).digest('hex').slice(0,32):crypto.randomBytes(16).toString('hex');
            const sessionId=ledger.start(p.id,{...s.meta,deviceKey:s.deviceKey,identityKind:declared?'declared':'session'});
            if(sessionId){s.id=p.id;s.username=p.username;clearTimeout(s.timer);publishAdmissions();ok=true;}
          }
        }
        if(!ok){deniedTotal++;if(s)s.kill();}
      }catch{deniedTotal++;}
      socket.end(JSON.stringify({ok})+'\n');
    });
  });
  await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(controlSocket,resolve);});fs.chmodSync(controlSocket,0o600);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const policyTimer=setInterval(refresh,250);policyTimer.unref();
  const reports=setInterval(()=>{try{ledger.report();publishAdmissions();fs.writeFileSync(path.join(directory,'status.json'),JSON.stringify({...health(),observedAt:new Date().toISOString()}),{mode:0o600});}catch{valid=false;for(const s of sessions)s.kill();}},1000);reports.unref();
  return {server,control,ledger,port:server.address().port,refresh,health,async close(){if(closed)return;closed=true;clearInterval(policyTimer);clearInterval(reports);for(const s of sessions)s.kill();await new Promise(r=>setImmediate(r));await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>control.close(r)),...(wss?[new Promise(r=>wss.close(r))]:[])]);ledger.close();try{fs.unlinkSync(controlSocket);}catch{}}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  startRawMeter().then(m=>{console.log('RAW_METER_LISTENING=true');const stop=()=>{m.close().then(()=>process.exit(0)).catch(()=>process.exit(1));};process.once('SIGTERM',stop);process.once('SIGINT',stop);}).catch(()=>{console.error('RAW_METER_STARTUP_FAILED');process.exitCode=1;});
}

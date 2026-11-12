/**
 * ABESS SSH over RFC6455 WebSocket, accounting for BOTH directions of the
 * SSH binary stream. The 256-bit per-account path secret is required before
 * opening any upstream SSH socket; common /ssh-ws access is no longer valid.
 *
 * One gateway process / one durable usage ledger per VPS. TLS terminates at
 * the operator's trusted Caddy WSS proxy, never in this loopback process.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {Transform} from 'node:stream';
import {WebSocketServer, createWebSocketStream} from 'ws';
import {pathToFileURL} from 'node:url';
import {QuotaLedger} from './ssh-ws-quota.mjs';

function validPort(value,allowZero=false){
  const p=Number(value);
  if(!Number.isInteger(p)||p<(allowZero?0:1)||p>65535)throw Error('Invalid TCP port');
  return p;
}
function meter(ledger,id,kill){
  return new Transform({
    highWaterMark:64*1024,
    transform(chunk,_encoding,callback){
      try{
        if(!Buffer.isBuffer(chunk)||chunk.length>65536){kill();return callback();}
        const take=ledger.consume(id,chunk.length);
        if(take===chunk.length)return callback(null,chunk);
        // Deliver no bytes beyond the exact remaining allowance.
        if(take>0)this.push(chunk.subarray(0,take));
        kill();
        return callback();
      }catch{kill();return callback();}
    }
  });
}
export async function startGateway(options={}){
  const port=validPort(options.port??process.env.SSH_WS_LISTEN_PORT??2080,true);
  const sshPort=validPort(options.sshPort??process.env.SSH_WS_SSH_PORT??2222);
  const basePath=options.path??process.env.SSH_WS_PATH??'/ssh-ws';
  const maxConnections=Number(options.maxConnections??process.env.SSH_WS_MAX_CONNECTIONS??512);
  const policyFile=options.policyFile??process.env.SSH_WS_POLICY_FILE??'/var/lib/abess-ssh-ws/policy/gateway-policy.json';
  const usageFile=options.usageFile??process.env.SSH_WS_USAGE_FILE??'/var/lib/abess-ssh-ws/gateway/usage.json';
  const reportFile=options.reportFile??process.env.SSH_WS_USAGE_REPORT_FILE??'/var/lib/abess-ssh-ws/gateway/usage-live.json';
  const policyPollMs=Number(options.policyPollMs??2000);
  if(!/^\/[A-Za-z0-9/_-]{1,80}$/.test(basePath) ||
     !Number.isInteger(maxConnections)||maxConnections<1||maxConnections>5000 ||
     !Number.isInteger(policyPollMs)||policyPollMs<100||policyPollMs>30000)
    throw Error('Invalid SSH-WS configuration');
  const ledger=new QuotaLedger({usageFile,reportFile});
  const wss=new WebSocketServer({
    noServer:true,perMessageDeflate:false,maxPayload:65536,
    clientTracking:true,skipUTF8Validation:false
  });
  let previousPolicy=null;
  let policyError=false;
  function refreshPolicy(){
    try {
      const raw=fs.readFileSync(policyFile,'utf8');
      if(raw!==previousPolicy){
        ledger.setPolicy(JSON.parse(raw));
        previousPolicy=raw;
      }
      policyError=false;
    }catch{
      // Never authorize from stale/malformed policy, even if previously valid.
      policyError=true;
    }
    for(const ws of wss.clients){
      if(policyError||!ledger.authorized(ws.accountId))ws.terminate();
    }
  }
  refreshPolicy(); // boot remains fail-closed until the reconciler provides a policy.
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.url==='/healthz'&&req.method==='GET'){
      res.writeHead(200).end(JSON.stringify({
        ok:!policyError,policyReady:!policyError&&Boolean(ledger.policy),
        connections:wss.clients.size
      }));
    }else res.writeHead(404).end(JSON.stringify({error:'not found'}));
  });
  server.headersTimeout=10000;
  server.requestTimeout=15000;
  server.maxHeadersCount=32;
  server.on('upgrade',(req,socket,head)=>{
    const secret=req.url?.startsWith(basePath+'/')?req.url.slice(basePath.length+1):null;
    const id=!policyError&&secret?ledger.findBySecret(secret):null;
    if(req.method!=='GET'||!id||wss.clients.size>=maxConnections||!ledger.start(id)){
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    try {
      wss.handleUpgrade(req,socket,head,ws=>{
        ws.accountId=id;
        wss.emit('connection',ws);
      });
    }catch {
      ledger.stop(id);
      socket.destroy();
    }
  });
  wss.on('connection',ws=>{
    const id=ws.accountId;
    ws.isAlive=true;
    ws.on('pong',()=>{ws.isAlive=true;});
    const upstream=net.createConnection({host:'127.0.0.1',port:sshPort});
    upstream.setNoDelay(true);
    upstream.setKeepAlive(true,30000);
    upstream.setTimeout(10000,()=>upstream.destroy(new Error('Local SSH timeout')));
    const stream=createWebSocketStream(ws,{highWaterMark:64*1024});
    let released=false;
    const release=()=>{
      if(released)return;
      released=true;
      ledger.stop(id);
    };
    const kill=()=>{upstream.destroy();ws.terminate();};
    ws.on('message',(_data,isBinary)=>{if(!isBinary)kill();});
    upstream.once('connect',()=>{
      upstream.setTimeout(0);
      const uplink=meter(ledger,id,kill);
      const downlink=meter(ledger,id,kill);
      uplink.on('error',kill);
      downlink.on('error',kill);
      stream.pipe(uplink).pipe(upstream);
      upstream.pipe(downlink).pipe(stream);
    });
    upstream.on('error',kill);
    upstream.on('close',()=>{if(ws.readyState===ws.OPEN)ws.close(1000);});
    stream.on('error',kill);
    stream.on('close',()=>{upstream.destroy();release();});
    ws.on('error',kill);
    ws.on('close',()=>{upstream.destroy();release();});
  });
  const heartbeat=setInterval(()=>{
    for(const ws of wss.clients){
      if(!ws.isAlive){ws.terminate();continue;}
      ws.isAlive=false;ws.ping();
    }
  },30000);
  const maintenance=setInterval(()=>{
    refreshPolicy();
    try{ledger.report();}catch{
      // Missing durable reporting is a safety failure, not a green health status.
      policyError=true;
      for(const ws of wss.clients)ws.terminate();
    }
  },policyPollMs);
  heartbeat.unref();maintenance.unref();
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(port,'127.0.0.1',resolve);
    });
  }catch(error){
    clearInterval(heartbeat);clearInterval(maintenance);
    throw error;
  }
  return {
    port:server.address().port,server,wss,ledger,refreshPolicy,
    async close(){
      clearInterval(heartbeat);clearInterval(maintenance);
      for(const ws of wss.clients)ws.terminate();
      await new Promise(resolve=>wss.close(resolve));
      await new Promise(resolve=>server.close(resolve));
      ledger.close();
    }
  };
}
async function main(){
  const gateway=await startGateway();
  process.stdout.write('[SSH-WS] quota enforced on loopback port '+gateway.port+'\n');
  const stop=async()=>{await gateway.close();process.exitCode=0;};
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error('[SSH-WS] Gateway startup refused');process.exitCode=1;});
}

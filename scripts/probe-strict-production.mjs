/** Real public TLS -> HTTP101 -> SSH -> PAM -> relay -> API verification.
 * Uses a temporary 0.01 GiB administrator-owned canary, no reseller credit.
 * Deletes it and revokes its verification session in finally. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import tls from 'node:tls';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
if(process.argv[2]==='--stdio-bridge'){
  const domain=process.argv[3],device=process.argv[4];
  if(process.argv[5]==='framed'){
    const {WebSocket,createWebSocketStream}=createRequire('/opt/abess-panel/package.json')('ws');
    const ws=new WebSocket('wss://'+domain+'/ssh-ws/strict-verification',{perMessageDeflate:false,headers:{'X-Abess-Device-ID':device,'X-Abess-Device-Name':'Controle serveur'}});
    const stream=createWebSocketStream(ws);ws.on('error',()=>process.exit(1));ws.on('close',()=>process.exit(0));stream.on('error',()=>process.exit(1));process.stdin.pipe(stream).pipe(process.stdout);
  }else{
  const socket=tls.connect({host:domain,port:443,servername:domain,rejectUnauthorized:true});let headers=Buffer.alloc(0),ready=false;
  socket.setTimeout(10000,()=>socket.destroy());
  socket.once('secureConnect',()=>socket.write(`GET /ssh-ws/strict-verification HTTP/1.1\r\nHost: ${domain}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Abess-Device-ID: ${device}\r\nX-Abess-Device-Name: Controle serveur\r\n\r\n`));
  socket.on('data',chunk=>{
    if(ready){if(!process.stdout.write(chunk))socket.pause();return;}
    headers=Buffer.concat([headers,chunk]);const end=headers.indexOf('\r\n\r\n');
    if(end<0){if(headers.length>8192)socket.destroy();return;}
    if(!headers.toString('latin1',0,end).startsWith('HTTP/1.1 101')){socket.destroy();return;}
    ready=true;socket.setTimeout(0);if(headers.length>end+4)process.stdout.write(headers.subarray(end+4));headers=null;process.stdin.pipe(socket);
  });
  process.stdout.on('drain',()=>socket.resume());socket.on('error',()=>process.exit(1));socket.on('close',()=>process.exit(0));
  }
}else{
  assert(process.getuid()===0,'Run on the intended production host as root');
  const domain=process.argv[2];assert(/^[A-Za-z0-9.-]+$/.test(domain));
  const script=fileURLToPath(import.meta.url),directory=fs.mkdtempSync(path.join(os.tmpdir(),'abess-strict-probe-'));
  const children=[];let token,account,echo;
  const dockerArgs=['compose','exec','-T','--interactive=false','api','node','--import','tsx','/app/scripts/strict-probe-session.mjs'];
  async function call(route,method='GET',body){const r=await fetch('http://127.0.0.1:3000/api/v1/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Canary API '+method+' '+route+' failed HTTP '+r.status);return r.status===204?null:r.json();}
  async function wait(fn,label){for(let i=0;i<80;i++){const result=await fn();if(result)return result;await delay(500);}throw Error('Canary timeout: '+label);}
  const passwd=crypto.randomBytes(18).toString('hex'),username='abv_check_'+crypto.randomBytes(5).toString('hex');
  const device='probe-'+crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(directory,'askpass'),'#!/bin/sh\nprintf "%s" "$ABESS_PROBE_PASSWORD"\n',{mode:0o700});
  const publicKey=fs.readFileSync('/etc/ssh/ssh_host_ed25519_key.pub','utf8').trim().split(/\s+/).slice(0,2).join(' ');
  fs.writeFileSync(path.join(directory,'known_hosts'),'abess-strict-probe,[abess-strict-probe]:443 '+publicKey+'\n',{mode:0o600});
  const launch=(forwardPort,echoPort,framed=false)=>{
    const args=['-N','-p','443','-o','HostKeyAlias=abess-strict-probe','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+path.join(directory,'known_hosts'),'-o','PreferredAuthentications=password','-o','PubkeyAuthentication=no','-o','NumberOfPasswordPrompts=1','-o','ConnectTimeout=8','-o','LogLevel=ERROR','-o',`ProxyCommand=${process.execPath} ${script} --stdio-bridge ${domain} ${device} ${framed?'framed':'raw'}`,'-L',`127.0.0.1:${forwardPort}:127.0.0.1:${echoPort}`,username+'@abess-strict-probe'];
    const p=spawn('ssh',args,{stdio:['ignore','ignore','pipe'],env:{...process.env,DISPLAY:'abess-verification',SSH_ASKPASS:path.join(directory,'askpass'),SSH_ASKPASS_REQUIRE:'force',ABESS_PROBE_PASSWORD:passwd}});p.diagnostic='';p.stderr.on('data',c=>{p.diagnostic=(p.diagnostic+c.toString()).slice(-2000)});children.push(p);return p;
  };
  async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
  const localUsage=()=>JSON.parse(fs.readFileSync('/var/lib/abess-raw-meter/usage-live.json','utf8')).accounts.find(a=>a.id===account.id);
  try{
    token=JSON.parse(execFileSync('docker',[...dockerArgs,'create'],{encoding:'utf8',timeout:15000})).token;
    const bootstrap=JSON.parse(fs.readFileSync('/etc/abess-ssh-ws/node-bootstrap.json','utf8'));
    account=await call('admin/ssh/managed','POST',{nodeId:bootstrap.id,label:'[Test automatique quotas]',username,password:passwd,days:30,quotaGb:0.01,maxConnections:1});
    await wait(async()=>{const inventory=await call('admin/ssh');return inventory.accounts.find(a=>a.id===account.id&&a.provisionState==='active')},'canary provisioning');
    echo=net.createServer(s=>{s.on('error',()=>{});s.pipe(s)});await new Promise(r=>echo.listen(0,'127.0.0.1',r));
    const port=await freePort(),first=launch(port,echo.address().port,true);
    await wait(()=>{if(first.exitCode!==null)throw Error('Public SSH canary failed: '+first.diagnostic);return localUsage()?.online===1},'public SSH authentication');
    const extra=launch(await freePort(),echo.address().port);await wait(()=>extra.exitCode!==null||extra.signalCode!==null,'extra session rejection');
    assert(first.exitCode===null&&first.signalCode===null);assert.equal(localUsage().online,1);
    const key=localUsage().devices[0].deviceKey;
    await wait(async()=>{const devices=await call(`admin/ssh/accounts/${account.id}/devices`);return devices.some(d=>d.deviceKey===key)},'device telemetry persistence');
    await call(`admin/ssh/accounts/${account.id}/devices/${key}`,'PUT',{blocked:true,name:'Controle des limites'});
    await wait(()=>first.exitCode!==null||first.signalCode!==null,'device suspension');
    await call(`admin/ssh/accounts/${account.id}/devices/${key}`,'PUT',{blocked:false});
    await wait(()=>{const p=JSON.parse(fs.readFileSync('/var/lib/abess-ssh-ws/policy/gateway-policy.json','utf8')).accounts.find(a=>a.id===account.id);return p&&!p.blockedDevices.includes(key)},'device reactivation');
    const port2=await freePort(),resumed=launch(port2,echo.address().port);await wait(()=>localUsage()?.online===1,'reactivated public SSH');
    await new Promise((resolve,reject)=>{
      const data=net.createConnection({host:'127.0.0.1',port:port2});data.on('error',()=>{});let sent=0;
      const timer=setTimeout(()=>{data.destroy();reject(Error('Quota traffic timed out'));},20000);
      const send=()=>{while(sent<32*1024*1024){sent+=65536;if(!data.write(Buffer.alloc(65536,120)))return;}};
      data.on('connect',send);data.on('drain',send);data.on('data',()=>{});data.on('close',()=>{clearTimeout(timer);resolve();});
    });
    await wait(()=>resumed.exitCode!==null||resumed.signalCode!==null,'quota disconnect');
    const spent=await wait(()=>{const u=localUsage();return u?.usedBytes===account.quotaBytes?u:null},'exact local quota');
    const persisted=await wait(async()=>{const i=await call('admin/ssh');return i.accounts.find(a=>a.id===account.id&&a.usedBytes===account.quotaBytes)},'API quota persistence');
    assert.equal(spent.usedBytes,account.quotaBytes);assert.equal(persisted.online,0);
    const view=await call(`admin/ssh/accounts/${account.id}/devices`);assert(view.some(d=>d.name==='Controle des limites'&&d.usedBytes>0));
    console.log('PRODUCTION_STRICT_LIMITS_VERIFIED='+JSON.stringify({publicRawAndFramedSsh:true,pamAdmission:true,maxSessionsNeverExceeded:true,deviceSuspendResume:true,exactQuotaBytes:spent.usedBytes,quotaNeverExceeded:true,apiPersistence:true}));
  }finally{
    for(const p of children)if(p.exitCode===null)p.kill('SIGTERM');if(echo)echo.close();
    try{if(account&&token)await call('admin/ssh/accounts/'+account.id,'DELETE');}
    finally{try{if(token){const args=[...dockerArgs];args[args.indexOf('--interactive=false')]='--interactive=true';execFileSync('docker',[...args,'revoke'],{input:JSON.stringify({token}),timeout:15000});}}finally{fs.rmSync(directory,{recursive:true,force:true});}}
  }
}

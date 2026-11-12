/**
 * LOCAL-ONLY, synthetic SSH-WS relay benchmark.
 * Does not test a real SSH daemon, WSS/TLS, or Internet throughput.
 * Run: node scripts/benchmark-ssh-ws.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {WebSocket} from 'ws';
import {startGateway} from './ssh-ws-gateway.mjs';

const cases=[1,4,12];
const rounds=12,blockSize=8192;
const dir=await mkdtemp(path.join(os.tmpdir(),'abess-ws-benchmark-'));
const policyFile=path.join(dir,'policy.json'),usageFile=path.join(dir,'usage.json'),reportFile=path.join(dir,'report.json');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const ids=Array.from({length:12},(_,i)=>'ssh_'+crypto.randomUUID());
const secrets=Array.from({length:12},()=>crypto.randomBytes(32).toString('base64url'));
const now=new Date();
const policy={format:'abess-ssh-ws-policy-v1',generatedAt:now.toISOString(),accounts:ids.map((id,i)=>({
  id,username:'abv_'+i.toString(16).padStart(12,'0'),sourceIp:'127.120.0.'+(i+1),
  tokenHash:hash(secrets[i]),enabled:true,expiresAt:new Date(Date.now()+3600000).toISOString(),
  quotaBytes:32*1024*1024,baselineUsedBytes:0,maxConnections:1
}))};
fs.writeFileSync(policyFile,JSON.stringify(policy));
let bytes=0;
const tcp=net.createServer(socket=>{
  socket.on('error',()=>{});
  socket.on('data',v=>{bytes+=v.length;socket.write(v);});
});
await new Promise((resolve,reject)=>{tcp.once('error',reject);tcp.listen(0,'127.0.0.1',resolve);});
const gateway=await startGateway({port:0,sshPort:tcp.address().port,path:'/ssh-ws',
  policyFile,usageFile,reportFile,maxConnections:32,policyPollMs:250});
function roundtrip(ws,payload) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error('relay timed out'));},8000);
    const cleanup=()=>{clearTimeout(timer);ws.off('message',onMessage);ws.off('error',onError);};
    let transferred=0;
    const onMessage=(v)=>{transferred+=v.length;if(transferred>=payload.length){cleanup();resolve();}};
    const onError=e=>{cleanup();reject(e);};
    ws.on('message',onMessage);ws.once('error',onError);
    ws.send(payload,{binary:true},e=>{if(e){cleanup();reject(e);}});
  });
}
async function onceOpen(ws) {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('connection timeout')),8000);
    ws.once('open',()=>{clearTimeout(timeout);resolve();});
    ws.once('error',e=>{clearTimeout(timeout);reject(e);});
  });
}
async function participant(i) {
  const ws=new WebSocket('ws://127.0.0.1:'+gateway.port+'/ssh-ws/'+secrets[i],
    {perMessageDeflate:false});
  await onceOpen(ws);
  const timings=[];
  try{
    const payload=crypto.randomBytes(blockSize);
    for(let k=0;k<rounds;k++){
      const start=performance.now();
      await roundtrip(ws,payload);
      timings.push(performance.now()-start);
    }
  }finally{ws.terminate();}
  return timings;
}
try{
  for(const clients of cases){
    const before=performance.now();
    const samples=(await Promise.all(Array.from({length:clients},(_,i)=>participant(i)))).flat().sort((a,b)=>a-b);
    const elapsed=(performance.now()-before)/1000;
    const logicalTransferred=clients*rounds*blockSize*2;
    const p=(percentile)=>samples[Math.min(samples.length-1,Math.floor((samples.length-1)*percentile))];
    const result={clients,roundTrips:samples.length,
      p50Ms:Number(p(0.5).toFixed(2)),p95Ms:Number(p(0.95).toFixed(2)),
      mibPerSec:Number((logicalTransferred/1048576/elapsed).toFixed(2)),
      elapsedSeconds:Number(elapsed.toFixed(2))};
    console.log(JSON.stringify(result));
  }
  console.log('Synthetic loopback gateway benchmark completed. NOT a VPS/ISP or SSH authentication benchmark.');
}finally{
  await gateway.close();await new Promise(resolve=>tcp.close(resolve));
  await rm(dir,{recursive:true,force:true});
}

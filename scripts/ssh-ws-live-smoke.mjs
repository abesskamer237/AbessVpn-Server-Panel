/** One-time controlled live SSH-WS end-to-end smoke; run INSIDE the ABESS API container.
 * Issues exactly one short-lived managed test licence and deletes it in finally.
 * Do not log credentials or the WSS bearer token.
 */
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire('/app/package.json');
const {WebSocket,createWebSocketStream}=require('ws');
const {Client}=require('ssh2');
const origin='http://127.0.0.1:3000';
const login=process.env.ADMIN_EMAIL;
const pw=process.env.ADMIN_INITIAL_PASSWORD;
if(!login||!pw)throw Error('Missing existing administrator environment');
const request=async(method,path,body,bearer)=>{
  const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(12000),redirect:'error',
    headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  let value={};
  try{value=await response.json()}catch{}
  if(!response.ok)throw Error(path+' returned HTTP '+response.status);
  return value;
};
let accountId,session,ssh,ws;
try {
  session=(await request('POST','/api/v1/auth/login',{email:login,password:pw})).token;
  if(!/^sess_[a-f0-9]{64}$/.test(session))throw Error('Cannot authenticate administrator for smoke test');
  const nodes=(await request('GET','/api/v1/admin/ssh',null,session)).managedNodes;
  const available=nodes?.filter(n=>n.agentOnline&&n.path==='/ssh-ws')||[];
  if(available.length!==1)throw Error('Expected exactly one online managed SSH-WS node');
  const created=await request('POST','/api/v1/admin/ssh/managed',{
    nodeId:available[0].id,label:'ONE-TIME SSH-WS smoke test - REMOVE',days:1,quotaGb:0.01,maxConnections:1
  },session);
  if(!/^ssh_[a-f0-9-]{36}$/.test(created.id||''))throw Error('Managed licence creation failed');
  accountId=created.id;
  console.log('SMOKE_TEST_ACCOUNT=created');
  let good=false;
  for(let n=0;n<35;n++){
    await delay(1000);
    const inv=await request('GET','/api/v1/admin/ssh',null,session);
    const a=inv.accounts.find(v=>v.id===accountId);
    if(a?.provisionState==='active'&&a?.trafficVerified&&a?.effectiveEnabled){good=true;break;}
    if(a?.provisionState==='error')throw Error('Host reconciler reported provision error');
  }
  if(!good)throw Error('Managed SSH-WS licence did not become active');
  console.log('SMOKE_TEST_PROVISION=active');
  const cfg=await request('POST','/api/v1/admin/ssh/accounts/'+accountId+'/config',{transport:'wss'},session);
  if(cfg.wire!=='websocket'||!cfg.path?.startsWith('/ssh-ws/')||!cfg.username||!cfg.password||!cfg.sni||
     !/^SHA256:[A-Za-z0-9+/]{43}$/.test(cfg.fingerprint||''))throw Error('Invalid WSS SSH configuration export');
  ws=new WebSocket('wss://'+cfg.sni+':'+cfg.port+cfg.path,{perMessageDeflate:false,handshakeTimeout:12000});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  console.log('SMOKE_TEST_WSS=websocket_open');
  ssh=new Client();
  const stream=createWebSocketStream(ws,{highWaterMark:65536});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('SSH authentication timed out')),14000);
    const finish=(err)=>{clearTimeout(timeout);if(err)reject(err);else resolve();};
    ssh.once('ready',()=>finish()).once('error',e=>finish(Error('SSH authentication failed: '+e.code)));
    ssh.connect({sock:stream,username:cfg.username,password:cfg.password,readyTimeout:12000,
      algorithms:{serverHostKey:['ssh-ed25519']},
      hostVerifier:raw=>{
        if(!Buffer.isBuffer(raw))return false;
        const fp='SHA256:'+crypto.createHash('sha256').update(raw).digest('base64').replace(/=+$/,'');
        return fp===cfg.fingerprint;
      }});
  });
  console.log('SMOKE_TEST_SSH=authenticated_with_expected_host_key');
  const forbidden=await new Promise((resolve,reject)=>{
    const second=new WebSocket('wss://'+cfg.sni+':'+cfg.port+cfg.path,{perMessageDeflate:false,handshakeTimeout:10000});
    const timeout=setTimeout(()=>{second.terminate();reject(Error('Second WebSocket admission timeout'))},12000);
    second.on('unexpected-response',(_req,res)=>{clearTimeout(timeout);const status=res.statusCode;res.resume();resolve(status)});
    second.once('open',()=>{clearTimeout(timeout);second.terminate();reject(Error('Concurrent second socket admitted'))});
    second.once('error',e=>{clearTimeout(timeout);reject(e)});
  });
  if(forbidden!==404)throw Error('Incorrect concurrent session rejection HTTP '+forbidden);
  console.log('SMOKE_TEST_SESSION_LIMIT=second_session_denied');
  console.log('SMOKE_TEST_END_TO_END=SUCCESS');
} finally {
  try{ssh?.end()}catch{}
  try{ws?.terminate()}catch{}
  if(accountId&&session){
    try{
      await request('DELETE','/api/v1/admin/ssh/accounts/'+accountId,null,session);
      console.log('SMOKE_TEST_ACCOUNT=deleted');
    }catch(e){console.error('SMOKE_TEST_CLEANUP_FAILED='+e.message);process.exitCode=1}
  }
}

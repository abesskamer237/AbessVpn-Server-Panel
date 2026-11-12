/**
 * Called INSIDE the ABESS API container after the first successful deployment.
 * Creates/enables an SSH-WS node via authenticated public panel APIs.
 * Its only stdout is {id,key} for redirection to a 0600 root-only VPS file.
 * No third-party X-NET code is included here.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const host=process.env.ABESS_NODE_HOST;
const sni=process.env.ABESS_SSH_SNI;
const fingerprint=process.env.ABESS_SSH_FINGERPRINT;
const panel='http://127.0.0.1:3000';
const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_INITIAL_PASSWORD;
if(!host||!sni||!fingerprint||!email||!password ||
   !/^[a-zA-Z0-9.-]+$/.test(host) || !/^[a-z0-9.-]+$/.test(sni) ||
   !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(fingerprint)) {
  throw Error('Missing or invalid node host, SNI, fingerprint or administrator bootstrap credentials');
}
async function request(method,uri,body,token){
  const res=await fetch(panel+uri,{method,redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const text=await res.text();
  let data={};try{data=JSON.parse(text);}catch{}
  if(!res.ok)throw Error('Panel API '+uri+' failed with HTTP '+res.status);
  return data;
}
const session=await request('POST','/api/v1/auth/login',{email,password});
if(!session.token||session.user?.role!=='SUPER_ADMIN')throw Error('Admin bootstrap session denied');
const list=await request('GET','/api/v1/admin/nodes',undefined,session.token);
if(!Array.isArray(list))throw Error('Unexpected panel node listing');
const existing=list.find(v=>v.host===host);
let credentials;
if(existing){
  // Safe idempotent retry after an interrupted *initial* bootstrap only:
  // never rotate keys of an active/provisioned VPS or unrelated agents.
  if(existing.name!=='ABESS SSH-WS automatic' || existing.sshWsManaged ||
     existing.lastSeenAt) throw Error('Host already registered; refusing to rotate existing node keys');
  credentials=await request('POST','/api/v1/admin/nodes/'+existing.id+'/key',undefined,session.token);
}else{
  credentials=await request('POST','/api/v1/admin/nodes',{
    name:'ABESS SSH-WS automatic',host},session.token);
}
if(!/^[a-f0-9-]{36}$/.test(credentials.id||'') ||
   !/^[a-f0-9]{64}$/.test(credentials.key||''))throw Error('Invalid node credential response');
const configured=await request('PUT','/api/v1/admin/nodes/'+credentials.id+'/ssh-ws',{
  enabled:true,fingerprint,sni,port:443,path:'/ssh-ws'
},session.token);
if(!configured.sshWsManaged)throw Error('SSH-WS node activation refused');
process.stdout.write(JSON.stringify({id:credentials.id,key:credentials.key})+'\n');

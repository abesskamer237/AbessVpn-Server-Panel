/**
 * Re-apply the public SSH-WSS edge/SNI and repair a stale node credential.
 * Runs inside the trusted API container during VPS post-deploy.
 */
const nodeId=process.env.ABESS_NODE_ID;
const sni=process.env.ABESS_SSH_SNI;
const fingerprint=process.env.ABESS_SSH_FINGERPRINT;
const currentNodeKey=String(process.env.ABESS_CURRENT_NODE_KEY||'').trim();
const panel='http://127.0.0.1:3000';
const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_INITIAL_PASSWORD;
if(!/^[a-f0-9-]{36}$/.test(nodeId||'')||!/^[a-z0-9.-]+$/.test(sni||'')||
   !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(fingerprint||'')||!email||!password)
  throw Error('Missing node/SNI/fingerprint/admin bootstrap data');

async function raw(method,uri,body,token){
  const res=await fetch(panel+uri,{method,redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const text=await res.text();let data={};try{data=JSON.parse(text);}catch{}
  return {res,data};
}
async function request(method,uri,body,token){
  const {res,data}=await raw(method,uri,body,token);
  if(!res.ok)throw Error('Panel API '+uri+' failed HTTP '+res.status);
  return data;
}

const session=await request('POST','/api/v1/auth/login',{email,password});
if(!session.token||session.user?.role!=='SUPER_ADMIN')throw Error('Admin session denied');

let key=currentNodeKey;
if(key){
  const probe=await raw('GET','/api/v1/nodes/'+nodeId+'/ssh-ws/desired',undefined,key);
  if(!probe.res.ok){
    if(probe.res.status!==401)throw Error('Node credential probe failed HTTP '+probe.res.status);
    const rotated=await request('POST','/api/v1/admin/nodes/'+nodeId+'/key',undefined,session.token);
    if(!/^[a-f0-9]{64}$/.test(rotated.key||''))throw Error('Invalid rotated node credential');
    key=rotated.key;
  }
}else{
  const rotated=await request('POST','/api/v1/admin/nodes/'+nodeId+'/key',undefined,session.token);
  if(!/^[a-f0-9]{64}$/.test(rotated.key||''))throw Error('Invalid rotated node credential');
  key=rotated.key;
}

const configured=await request('PUT','/api/v1/admin/nodes/'+nodeId+'/ssh-ws',{
  enabled:true,fingerprint,sni,port:443,path:'/ssh-ws'
},session.token);
if(configured.sshWsSni!==sni||configured.sshWsPort!==443||configured.sshWsPath!=='/ssh-ws')
  throw Error('Edge host update was not persisted');

const finalProbe=await raw('GET','/api/v1/nodes/'+nodeId+'/ssh-ws/desired',undefined,key);
if(!finalProbe.res.ok)throw Error('Repaired node credential still rejected HTTP '+finalProbe.res.status);
process.stdout.write(JSON.stringify({ok:true,nodeId,sni,key})+'\n');

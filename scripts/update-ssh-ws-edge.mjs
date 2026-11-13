/**
 * Re-apply the public SSH-WSS edge/SNI to an already provisioned node.
 * Runs inside the trusted API container during VPS post-deploy.
 */
const nodeId=process.env.ABESS_NODE_ID;
const sni=process.env.ABESS_SSH_SNI;
const fingerprint=process.env.ABESS_SSH_FINGERPRINT;
const panel='http://127.0.0.1:3000';
const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_INITIAL_PASSWORD;
if(!/^[a-f0-9-]{36}$/.test(nodeId||'')||!/^[a-z0-9.-]+$/.test(sni||'')||
   !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(fingerprint||'')||!email||!password)
  throw Error('Missing node/SNI/fingerprint/admin bootstrap data');
async function request(method,uri,body,token){
  const res=await fetch(panel+uri,{method,redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const text=await res.text();let data={};try{data=JSON.parse(text);}catch{}
  if(!res.ok)throw Error('Panel API '+uri+' failed HTTP '+res.status);
  return data;
}
const session=await request('POST','/api/v1/auth/login',{email,password});
if(!session.token||session.user?.role!=='SUPER_ADMIN')throw Error('Admin session denied');
const configured=await request('PUT','/api/v1/admin/nodes/'+nodeId+'/ssh-ws',{
  enabled:true,fingerprint,sni,port:443,path:'/ssh-ws'
},session.token);
if(configured.sshWsSni!==sni||configured.sshWsPort!==443||configured.sshWsPath!=='/ssh-ws')
  throw Error('Edge host update was not persisted');
process.stdout.write(JSON.stringify({ok:true,nodeId,sni})+'\n');

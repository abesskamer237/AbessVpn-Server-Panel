const nodeId=process.env.ABESS_NODE_ID;
const panel='http://127.0.0.1:3000';
const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_INITIAL_PASSWORD;
if(!/^[a-f0-9-]{36}$/.test(nodeId||'')||!email||!password)throw Error('Missing node/admin data');
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
const rotated=await request('POST','/api/v1/admin/nodes/'+nodeId+'/key',undefined,session.token);
if(!/^[a-f0-9]{64}$/.test(rotated.key||''))throw Error('Invalid rotated key');
process.stdout.write(rotated.key);

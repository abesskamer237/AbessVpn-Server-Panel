import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {reportOnce} from './node-agent.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'abess-external-'));
let pool, schema, database='';
if(process.env.TEST_DATABASE_URL){
  pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});schema='external_'+randomBytes(8).toString('hex');
  await pool.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);database=url.toString();
}
const password=randomBytes(24).toString('hex');
const env={...process.env,DATABASE_URL:database,DATA_DIR:dir,PORT:'3231',NODE_ENV:'production',ALLOW_JSON_STORAGE:'true',VPN_DOMAIN:'panel.example.test',ADMIN_EMAIL:'external@example.test',ADMIN_INITIAL_PASSWORD:password,MASTER_SECRET:randomBytes(32).toString('hex'),SSH_GATEWAY_ENABLED:'true',TELEGRAM_BOT_TOKEN:''};
let server, logs='';
async function start(){
  server=spawn(process.execPath,['--import','tsx','server.ts'],{env,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error('API exited: '+logs);
    try{if((await call('ping')).status===200)return;}catch{}
    await delay(100);
  }
  throw Error('API startup timed out');
}
async function stop(){if(server && server.exitCode===null){server.kill();await new Promise(r=>server.once('close',r));}server=null;}
async function call(route,body,token,method,extra={}){
  const r=await fetch('http://127.0.0.1:3231/api/v1/'+route,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...extra,...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  return {status:r.status,body:r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text()};
}
let tick=0;
const observed=()=>new Date(Date.now()+(++tick)).toISOString();
try{
  await start();
  const auth=await call('auth/login',{email:env.ADMIN_EMAIL,password});assert.equal(auth.status,200);const admin=auth.body.token;
  const node=await call('admin/nodes',{name:'Manual VPS',host:'external.example.test'},admin);assert.equal(node.status,201);
  const other=await call('admin/nodes',{name:'Other VPS',host:'other.example.test'},admin);assert.equal(other.status,201);
  const profile=await call('admin/protocol-configs',{name:'Manual TLS',serverHost:'external.example.test',serverPort:8443,protocol:'vless',transport:'ws',path:'/custom/vpn',sniHost:'certificate.example.test',host:'header.example.test'},admin);assert.equal(profile.status,201);
  assert.equal(profile.body.config.serverPort,8443);assert.equal(profile.body.config.path,'/custom/vpn');
  for(const port of [0,65536,1.5])assert.equal((await call('admin/protocol-configs',{...profile.body.config,name:'Bad port',serverPort:port},admin)).status,400);
  const uuid=randomUUID();const licence=await call('admin/tokens',{configurationId:profile.body.config.id,clientUuid:uuid,trafficId:'manual@example.test',bandwidthGb:1,days:30,deviceLimit:2},admin);assert.equal(licence.status,201);assert.equal(licence.body.clientUuid,uuid);
  assert.equal((await call('admin/tokens',{configurationId:profile.body.config.id,clientUuid:uuid,bandwidthGb:1,days:30},admin)).status,409);
  const variants=await call(`admin/tokens/${licence.body.id}/variants`,undefined,admin);assert.equal(variants.status,200);
  assert.equal(variants.body.variants.length,1);const uri=new URL(variants.body.variants[0].uri);assert.equal(uri.port,'8443');assert.equal(uri.searchParams.get('path'),'/custom/vpn');assert.equal(uri.searchParams.get('sni'),'certificate.example.test');
  const inventory=await call(`nodes/${node.body.id}/config`,undefined,node.body.key);assert.equal(inventory.body.format,'abess-external-inventory-v1');
  assert.ok(!('inbounds' in inventory.body));assert.ok(!JSON.stringify(inventory.body).includes(licence.body.token));
  const used=async()=>((await call('admin/tokens',undefined,admin)).body.find(t=>t.id===licence.body.id));
  const sample=(value,generation='manual-process-1')=>({generation,observedAt:observed(),stat:[{name:`user>>>manual@example.test>>>traffic>>>uplink`,value}]});
  const send=(snapshot,n=node,key=n.body.key)=>call(`nodes/${n.body.id}/heartbeat`,{ready:true,snapshot},key);
  let snapshot=sample(1024);
  assert.equal((await send(snapshot,node,'wrong')).status,401);
  assert.equal((await send(snapshot,other)).status,200);assert.equal((await used()).bandwidthUsedGb,0,'another VPS cannot bill this licence');
  assert.equal((await send(snapshot)).status,200);assert.equal((await send(snapshot)).status,200);assert.equal((await used()).bandwidthUsedGb*1024**3,1024);
  assert.equal((await call('auth/token',{token:licence.body.token,deviceId:'external-device-test'})).status,200);
  assert.equal((await call('client/availability',{token:licence.body.token,deviceId:'external-device-test'})).body.dataPlane,'ready');
  assert.equal((await send({...snapshot,observedAt:new Date(Date.now()-120000).toISOString()})).status,400);
  assert.equal((await send({...snapshot,observedAt:new Date(Date.now()+120000).toISOString()})).status,400);
  assert.equal((await send({...snapshot,stat:[{...snapshot.stat[0],value:2048}]})).status,400,'same timestamp cannot change counters');
  for(const value of [-1,Number.MAX_SAFE_INTEGER+1,'NaN',''])assert.equal((await send(sample(value))).status,400);
  const dup=sample(2048);dup.stat.push({...dup.stat[0]});assert.equal((await send(dup)).status,400);
  assert.equal((await send(sample(512))).status,400,'reset requires a new process generation');
  assert.equal((await used()).bandwidthUsedGb*1024**3,1024,'invalid snapshots never modify billing');
  assert.equal((await send({generation:'manual-process-1',observedAt:observed(),stat:[]})).status,200);
  assert.equal((await send(sample(2048))).status,200);assert.equal((await used()).bandwidthUsedGb*1024**3,2048,'partial reports retain previous counter baselines');
  assert.equal((await send(sample(100,'manual-process-2'))).status,200);assert.equal((await used()).bandwidthUsedGb*1024**3,2148);
  const config={host:'external.example.test',port:2084,username:'manual_user',password:randomBytes(20).toString('hex'),transport:'wss-raw-alt',tls:true,sni:'certificate.example.test',path:'/ssh-existing',fingerprint:'SHA256:'+randomBytes(32).toString('base64').replace(/=+$/,'')};
  const ssh=await call('admin/ssh/accounts',{nodeId:node.body.id,config,days:30,quotaGb:1,maxConnections:2},admin);assert.equal(ssh.status,201);assert.ok(!JSON.stringify(ssh.body).includes(config.password));
  assert.equal((await call('admin/ssh/accounts',{username:'new_user',days:30,quotaGb:1,maxConnections:1},admin)).status,400,'cannot create a local SSH user');
  snapshot=sample(200,'manual-process-2');snapshot.accounts=[{id:ssh.body.id,usedBytes:1234,online:1}];snapshot.stat.push({name:'user>>>manual@example.test>>>online',value:2});assert.equal((await send(snapshot)).status,200);
  assert.equal((await call('admin/stats',undefined,admin)).body.activeTunnelConnections,3);
  const beforeInvalidSsh=(await used()).bandwidthUsedGb;
  const invalidSsh=sample(250,'manual-process-2');invalidSsh.accounts=[{id:ssh.body.id,usedBytes:100}];
  assert.equal((await send(invalidSsh)).status,400);assert.equal((await used()).bandwidthUsedGb,beforeInvalidSsh,'SSH failure cannot partially bill VPN counters');
  const exported=await call(`admin/ssh/accounts/${ssh.body.id}/config`,{transport:config.transport},admin);assert.equal(exported.status,200);assert.equal(exported.body.password,config.password);assert.equal(exported.body.port,2084);assert.equal(exported.body.path,config.path);
  const sshList=await call('admin/ssh',undefined,admin);assert.equal(sshList.body.accounts[0].usedBytes,1234);assert.ok(!JSON.stringify(sshList.body).includes(config.password));
  // A paid SSH account follows the same credit ledger and tenant hierarchy as VLESS.
  const sellerPassword=randomBytes(24).toString('hex');
  const seller=await call('admin/resellers',{email:'ssh-seller@example.test',name:'SSH Seller',password:sellerPassword,initialCredits:4},admin);assert.equal(seller.status,201);
  const peer=await call('admin/resellers',{email:'ssh-peer@example.test',name:'SSH Peer',password:sellerPassword,initialCredits:0},admin);assert.equal(peer.status,201);
  const sellerSession=(await call('auth/login',{email:'ssh-seller@example.test',password:sellerPassword})).body.token;
  const peerSession=(await call('auth/login',{email:'ssh-peer@example.test',password:sellerPassword})).body.token;
  const customPayload='CONNECT [host_port] [protocol][crlf]Host: [host][crlf]X-Payload: commercial[crlf][crlf]';
  const saleBody={nodeId:node.body.id,resellerId:seller.body.id,config:{...config,username:'sold_user',transport:'tcp',port:8080,tls:false,payload:customPayload},days:30,quotaGb:1,maxConnections:2};
  const history=(await call('admin/transactions',undefined,admin)).body;
  const historical=Array.from({length:1001},(_,i)=>({id:'historical_'+i,resellerId:seller.body.id,type:'CREDIT_ADD',amountGb:1,balanceBefore:0,balanceAfter:1,note:'Historical fixture',timestamp:new Date().toISOString()}));
  if(pool)await pool.query(`UPDATE ${schema}.app_documents SET value=$1::jsonb WHERE name='transactions.json'`,[JSON.stringify([...history,...historical])]);
  else await writeFile(path.join(dir,'transactions.json'),JSON.stringify([...history,...historical]));
  const sales=await Promise.all([call('admin/ssh/accounts',saleBody,admin),call('admin/ssh/accounts',saleBody,admin)]);
  assert.equal(sales.filter(r=>r.status===201).length,1,'concurrent sale only charges once');
  const sale=sales.find(r=>r.status===201);assert.equal(sale.status,201);assert.equal(sale.body.quotaBytes,1024**3);assert.equal(sale.body.connection.wire,'http-connect');
  assert.equal((await call('auth/me',undefined,sellerSession)).body.credits,3);
  assert.equal((await call('admin/ssh/accounts',saleBody,admin)).status,409);assert.equal((await call('auth/me',undefined,sellerSession)).body.credits,3,'duplicate sale cannot charge twice');
  assert.equal((await call('admin/ssh/accounts',{...saleBody,resellerId:peer.body.id,config:{...saleBody.config,username:'unfunded_user'}},admin)).status,409);
  assert.equal((await call('admin/ssh/accounts',saleBody,sellerSession)).status,403,'reseller cannot import infrastructure');
  const ownerList=(await call('admin/ssh',undefined,sellerSession)).body;
  assert.equal(ownerList.accounts.length,1);assert.equal(ownerList.nodes.length,0);assert.equal(ownerList.accounts[0].connection.host,undefined);
  assert.ok(!JSON.stringify(ownerList).includes(customPayload));assert.ok(!JSON.stringify(ownerList).includes(config.password));
  const delivery=await call(`admin/ssh/accounts/${sale.body.id}/config`,{transport:'tcp'},sellerSession);assert.equal(delivery.status,200);assert.equal(delivery.body.payload,customPayload);
  for(const mode of ['ws','ws-framed','wss','wss-raw']){
    const extraAccount=await call('admin/ssh/accounts',{...saleBody,resellerId:undefined,config:{...config,username:'mode_'+mode.replaceAll('-','_'),transport:mode,tls:mode.startsWith('wss')}},admin);
    assert.equal(extraAccount.status,201);const result=await call(`admin/ssh/accounts/${extraAccount.body.id}/config`,{transport:mode},admin);assert.equal(result.status,200);
    assert.equal(result.body.wire,['ws-framed','wss'].includes(mode)?'websocket':'http-upgrade');
  }
  for(const payload of ['GET / HTTP/1.1[unknown]','GET / HTTP/1.1'+String.fromCharCode(0),'x'.repeat(9000)])
    assert.equal((await call('admin/ssh/accounts',{...saleBody,config:{...saleBody.config,username:'bad_payload',payload}},admin)).status,400);
  assert.equal((await call(`admin/ssh/accounts/${sale.body.id}/config`,{transport:'tcp'},peerSession)).status,403);
  assert.equal((await call(`admin/ssh/accounts/${sale.body.id}`,{enabled:false},peerSession,'PATCH')).status,403);
  assert.equal((await call(`admin/ssh/accounts/${sale.body.id}`,undefined,sellerSession,'DELETE')).status,403);
  const sshUsage=sample(300,'manual-process-2');sshUsage.accounts=[{id:sale.body.id,usedBytes:900,online:1}];assert.equal((await send(sshUsage)).status,200);
  const renewalHeaders={'Idempotency-Key':'ssh-renewal-test-0001'};
  const renew=()=>call(`admin/ssh/accounts/${sale.body.id}/renew`,{additionalGb:1,days:7},sellerSession,undefined,renewalHeaders);
  const renewals=await Promise.all([renew(),renew(),renew()]);assert.ok(renewals.every(r=>r.status===200));assert.equal(renewals[0].body.usedBytes,900);assert.equal(renewals[0].body.quotaBytes,2*1024**3);
  assert.equal((await call('auth/me',undefined,sellerSession)).body.credits,2,'concurrent renewals debit exactly once');
  assert.equal((await call(`admin/ssh/accounts/${sale.body.id}/renew`,{additionalGb:2,days:7},sellerSession,undefined,renewalHeaders)).status,409,'a reused key cannot describe a different purchase');
  assert.equal((await call(`admin/ssh/accounts/${sale.body.id}/renew`,{additionalGb:20,days:7},sellerSession,undefined,{'Idempotency-Key':'ssh-renewal-test-0002'})).status,409);
  const ledger=(await call('admin/transactions',undefined,admin)).body;
  assert.equal(ledger.filter(t=>t.id.startsWith('historical_')).length,1001,'financial history is never truncated');
  assert.equal(ledger.filter(t=>t.type==='SSH_SALE'&&t.note.includes(sale.body.id)).length,1);assert.equal(ledger.filter(t=>t.type==='SSH_RENEW'&&t.note.includes(sale.body.id)).length,1);
  assert.equal((await call(`admin/resellers/${seller.body.id}/status`,{status:'suspended'},admin,'PUT')).status,200);
  const afterSuspension=(await call(`nodes/${node.body.id}/config`,undefined,node.body.key)).body;
  assert.equal(afterSuspension.sshAccounts.find(a=>a.id===sale.body.id).enabled,false,'suspended sellers cannot keep active SSH entitlements');
  assert.equal((await call(`admin/ssh/accounts/${ssh.body.id}`,{enabled:false},admin,'PATCH')).status,200);
  assert.equal((await call(`admin/ssh/accounts/${ssh.body.id}/config`,{transport:config.transport},admin)).status,503);
  snapshot=sample(2*1024**3,'manual-process-2');assert.equal((await send(snapshot)).status,200);
  const exhausted=await used();assert.equal(exhausted.status,'quota_exceeded');assert.ok(exhausted.bandwidthUsedGb>1,'retain actual usage beyond quota');
  assert.equal((await call('auth/token',{token:licence.body.token,deviceId:'external-device-test'})).status,403);
  assert.equal((await call(`nodes/${node.body.id}/config`,undefined,node.body.key)).body.licences[0].enabled,false);
  await stop();await start();assert.equal((await send(snapshot)).status,200);assert.equal((await used()).bandwidthUsedGb,exhausted.bandwidthUsedGb,'restart does not double bill');
  assert.ok(!(await readdir(dir)).some(f=>['xray-config.json','xray-control-heartbeat','ssh-control'].includes(f)), 'no engine config files, even with legacy gateway flag');
  // The reporting agent reads a supplied file and only posts heartbeat messages.
  const lastAccepted=snapshot;
  const file=path.join(dir,'stats-source.json');snapshot=sample(999);const serialized=JSON.stringify(snapshot);await writeFile(file,serialized);
  const requests=[];const request=async(url,options)=>{requests.push({url:String(url),options});return {ok:true,json:async()=>snapshot};};
  const agentEnv={CONTROL_API_BASE_URL:'https://panel.example.test',VPN_NODE_ID:node.body.id,VPN_NODE_KEY:node.body.key,STATS_FILE:file};
  await reportOnce(agentEnv,request);assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('/heartbeat'));assert.equal(requests[0].options.method,'POST');assert.equal(JSON.parse(requests[0].options.body).snapshot.generation,snapshot.generation);assert.equal(await readFile(file,'utf8'),serialized);
  await reportOnce({...agentEnv,STATS_FILE:file+'.missing'},request);assert.equal(JSON.parse(requests.at(-1).options.body).ready,false);
  await reportOnce({...agentEnv,STATS_API_URL:'https://stats.example.test/snapshot'},request);assert.equal(requests.at(-2).url,'https://stats.example.test/snapshot');assert.deepEqual(requests.at(-2).options.headers,{},'node key must not leak to external stats API');
  const beforeRotation=(await used()).bandwidthUsedGb;
  assert.equal((await call(`admin/nodes/${node.body.id}/key`,{},sellerSession)).status,401,'suspended reseller cannot rotate infrastructure keys');
  const rotated=await call(`admin/nodes/${node.body.id}/key`,{},admin);assert.equal(rotated.status,200);
  assert.equal((await send(sample(1))).status,401,'old node key is revoked immediately');
  node.body.key=rotated.body.key;
  assert.equal((await send(lastAccepted)).status,200);assert.equal((await used()).bandwidthUsedGb,beforeRotation,'key rotation preserves traffic baselines');
  await call(`admin/nodes/${node.body.id}`,undefined,admin,'DELETE');assert.equal((await send(sample(1))).status,401);
  console.log(`External backend passed (${database?'PostgreSQL':'JSON'}): manual endpoints/UUID, client exports, node isolation, real counters, duplicate/reset/replay validation, SSH import/export, persistence, reporting-only agent, no provisioned services.`);
}finally{
  await stop();await rm(dir,{recursive:true,force:true});
  if(pool){await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();}
}

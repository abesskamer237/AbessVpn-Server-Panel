import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {startGateway} from './ssh-ws-gateway.mjs';
import {QuotaLedger,validatePolicy} from './ssh-ws-quota.mjs';
import {validateDesired,reconcile,failClosedOffline,httpsOrigin,syncOnce} from './ssh-ws-reconciler.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'abess-ssh-ws-quota-'));
const usageFile=path.join(dir,'durable-usage.json');
const reportFile=path.join(dir,'usage-live.json');
const policyFile=path.join(dir,'policy.json');
const id='ssh_0d94c3b5-87b4-4c1e-a444-a24c1da6780e';
const idB='ssh_0d94c3b5-87b4-4c1e-a444-a24c1da6780f';
const user='abv_012345abcdef';
const userB='abv_012345abcdee';
const password='x'.repeat(43);
const key=crypto.randomBytes(32).toString('base64url');
const keyB=crypto.randomBytes(32).toString('base64url');
const hash=k=>crypto.createHash('sha256').update(k).digest('hex');
const account=(accountId,username,token,quota,maxConnections)=>({
  id:accountId,username,tokenHash:hash(token),enabled:true,
  expiresAt:new Date(Date.now()+86400000).toISOString(),
  quotaBytes:quota,baselineUsedBytes:0,maxConnections
});
let policy={format:'abess-ssh-ws-policy-v1',generatedAt:new Date().toISOString(),
  accounts:[account(id,user,key,4096,1),account(idB,userB,keyB,1048576,2)]};
assert.equal(validatePolicy(policy).accounts.length,2);
assert.throws(()=>validatePolicy({...policy,accounts:[policy.accounts[0],policy.accounts[0]]}));
assert.throws(()=>validatePolicy({...policy,accounts:[{...policy.accounts[0],quotaBytes:-1}]}));
fs.writeFileSync(policyFile,JSON.stringify(policy));

const tcp=net.createServer(socket=>{
  socket.write('SSH-2.0-ABESS-test\r\n');
  socket.on('data',chunk=>socket.write(chunk));
});
await new Promise(resolve=>tcp.listen(0,'127.0.0.1',resolve));
const gatewayOptions={port:0,sshPort:tcp.address().port,
  path:'/ssh-ws',maxConnections:20,policyFile,usageFile,reportFile,policyPollMs:100};
let gateway=await startGateway(gatewayOptions);
const connect=async token=>{
  const ws=new WebSocket(`ws://127.0.0.1:${gateway.port}/ssh-ws/${token}`,{perMessageDeflate:false});
  await once(ws,'open');
  return ws;
};
const rejected=async token=>{
  const ws=new WebSocket(`ws://127.0.0.1:${gateway.port}/ssh-ws/${token}`);
  return new Promise((resolve,reject)=>{
    ws.once('unexpected-response',(_req,response)=>{
      const status=response.statusCode;
      response.resume();
      resolve(status);
    });
    ws.once('error',reject);
    ws.once('open',()=>reject(Error('Unexpected connection authorization')));
  });
};
try {
  const health=await (await fetch(`http://127.0.0.1:${gateway.port}/healthz`)).json();
  assert.equal(health.policyReady,true);
  assert.equal(await rejected('invalid'),404);
  assert.equal(await rejected(key.slice(0,-1)+'A'),404);
  assert.equal(await rejected(''),404);
  const a=await connect(key);
  const received=once(a,'message');
  // The banner may already have been emitted immediately after opening;
  // use a second connection with a listener installed before its open event.
  assert.equal(gateway.ledger.online(id),1);
  assert.equal(await rejected(key),404,'a second socket must not bypass per-user maxConnections');
  const b=await connect(keyB);
  assert.equal(gateway.ledger.online(idB),1);
  const message=once(b,'message');
  b.send(Buffer.from('echo-check'));
  let echo=(await message)[0].toString();
  // Depending on frame timing this may be the upstream SSH banner.
  if(echo.startsWith('SSH-2.0'))echo=(await once(b,'message'))[0].toString();
  assert.equal(echo,'echo-check');
  gateway.ledger.report();
  const measured=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  assert.ok(measured.accounts.find(x=>x.id===idB).usedBytes>=2*'echo-check'.length);
  assert.equal(measured.accounts.find(x=>x.id===idB).online,1);
  assert.equal(measured.policyObservedAt,policy.generatedAt);

  // Hard budget. 64 KiB frames; full body not allowed when allowance is small.
  const exhausted=once(a,'close');
  a.send(Buffer.alloc(3500,0x34));
  await exhausted;
  assert.ok(gateway.ledger.used(id)<=4096);
  assert.ok(gateway.ledger.used(id)>0);
  assert.equal(await rejected(key),404,'a spent quota is not reset by reconnecting');
  b.close();
  await once(b,'close');

  // Raising quota permits a new session; changing policy to disabled evicts it.
  policy={...policy,generatedAt:new Date().toISOString(),
    accounts:policy.accounts.map(p=>p.id===id?{...p,quotaBytes:12288}:p)};
  fs.writeFileSync(policyFile,JSON.stringify(policy));
  gateway.refreshPolicy();
  const revived=await connect(key);
  policy={...policy,generatedAt:new Date().toISOString(),
    accounts:policy.accounts.map(p=>p.id===id?{...p,enabled:false}:p)};
  fs.writeFileSync(policyFile,JSON.stringify(policy));
  const closed=once(revived,'close');
  gateway.refreshPolicy();
  await closed;
  assert.equal(await rejected(key),404);

  await gateway.close();
  const before=JSON.parse(fs.readFileSync(usageFile,'utf8')).balances[id];
  gateway=await startGateway(gatewayOptions);
  assert.ok(gateway.ledger.used(id)>=before,'restart must not reset consumed bytes');
  assert.equal(await rejected(key),404);
  assert.throws(()=>new QuotaLedger({usageFile:'/missing/usage.json',reportFile:''}));
} finally {
  await gateway.close().catch(()=>{});
  await new Promise(resolve=>tcp.close(resolve));
}

// Check that unclean crashes cannot restore spent bandwidth: committed
// reservation is greater or equal to actual bytes moved.
const crashFile=path.join(dir,'crash-usage.json');
const ledger=new QuotaLedger({usageFile:crashFile,reportFile:path.join(dir,'crash-report.json')});
ledger.setPolicy({...policy,generatedAt:new Date().toISOString(),
  accounts:policy.accounts.map(p=>({...p,enabled:true,baselineUsedBytes:0}))});
assert.equal(ledger.consume(id,1200),1200);
const recovered=new QuotaLedger({usageFile:crashFile,reportFile:path.join(dir,'crash-recovered.json')});
assert.ok(recovered.used(id)>=1200,'fsynced advance-reservation avoids free replays');
assert.ok(recovered.used(id)<=12288);

const desired={format:'abess-managed-ssh-ws-v1',observedAt:new Date().toISOString(),
  accounts:[{id,username:user,password,expiresAt:new Date(Date.now()+86400000).toISOString(),
    enabled:true,tokenHash:hash(key),quotaBytes:12288,baselineUsedBytes:0,maxConnections:1}]};
assert.equal(validateDesired(desired).length,1);
assert.throws(()=>validateDesired({...desired,accounts:[{...desired.accounts[0],username:'root'}]}));
assert.throws(()=>validateDesired({...desired,accounts:[{...desired.accounts[0],maxConnections:999}]}));
const users=new Set(),commands=[];
const host={
  exists(name){return users.has(name);},
  create(name){commands.push('create');users.add(name);},
  password(_name,value){commands.push('password');assert.equal(value,password);},
  enable(){commands.push('enable');},
  disable(){commands.push('disable');}
};
let first=await reconcile(desired,{},host);
assert.deepEqual(first.reports,[{id,state:'active'}]);
assert.deepEqual(commands,['create','password','enable']);
let again=await reconcile(desired,first.state,host);
assert.deepEqual(commands,['create','password','enable']);
users.delete(user);
const recreated=await reconcile(desired,again.state,host);
assert.deepEqual(commands.slice(-3),['create','password','enable']);
again=recreated;
const blocked=await reconcile({...desired,accounts:[{...desired.accounts[0],enabled:false,password:undefined}]},again.state,host);
assert.equal(blocked.reports[0].state,'blocked');
const oldCount=commands.length;
failClosedOffline({state:first.state,lastSuccessfulAt:Date.now()-700000},host);
assert.equal(commands.length,oldCount+1);
assert.throws(()=>httpsOrigin('http://panel.example.test'));
assert.equal(httpsOrigin('https://panel.example.test').hostname,'panel.example.test');
const mocked=[];
const store={state:again.state,lastSuccessfulAt:0,
  async writePolicy(x){store.published=x;},
  async readUsage(t){return {format:'abess-ssh-ws-usage-v1',
    policyObservedAt:t,observedAt:new Date().toISOString(),
    accounts:[{id,usedBytes:100,online:1}]};}
};
const request=async(url,opts)=>{
  mocked.push({url:String(url),method:opts.method,body:opts.body});
  return {ok:true,json:async()=>desired};
};
await syncOnce({CONTROL_API_BASE_URL:'https://panel.example.test',
  VPN_NODE_ID:'0d94c3b5-87b4-4c1e-a444-a24c1da6780e',VPN_NODE_KEY:'ci-only-key'},
request,host,store);
assert.equal(mocked.length,2);
assert.equal(store.published.accounts[0].quotaBytes,12288);
assert.equal(store.published.accounts[0].maxConnections,1);
assert.equal(store.published.accounts[0].tokenHash,hash(key));
const sent=JSON.parse(mocked[1].body).reports[0];
assert.equal(sent.state,'active');assert.equal(sent.usedBytes,100);assert.equal(sent.online,1);
await rm(dir,{recursive:true,force:true});
console.log('SSH-WS enforced bandwidth, sessions, persistence and agent report tests passed.');

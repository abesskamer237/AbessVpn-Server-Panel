import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {startGateway} from './ssh-ws-gateway.mjs';
import {validateDesired,reconcile,failClosedOffline,httpsOrigin,syncOnce} from './ssh-ws-reconciler.mjs';

const tcp=net.createServer(socket=>{
  socket.write('SSH-2.0-ABESS-test\r\n');
  socket.on('data',chunk=>socket.write(chunk));
});
await new Promise(resolve=>tcp.listen(0,'127.0.0.1',resolve));
const gateway=await startGateway({port:0,sshPort:tcp.address().port,path:'/ssh-ws',maxConnections:2});
try {
  const health=await fetch(`http://127.0.0.1:${gateway.port}/healthz`);
  assert.equal((await health.json()).ok,true);
  assert.equal((await fetch(`http://127.0.0.1:${gateway.port}/other`)).status,404);
  const ws=new WebSocket(`ws://127.0.0.1:${gateway.port}/ssh-ws`,{perMessageDeflate:false});
  const greeting=once(ws,'message');
  await once(ws,'open');
  assert.equal((await greeting)[0].toString(),'SSH-2.0-ABESS-test\r\n');
  const echoed=once(ws,'message');
  ws.send(Buffer.from('SSH-WS-binary-echo'));
  assert.equal((await echoed)[0].toString(),'SSH-WS-binary-echo');
  const data=Buffer.alloc(32768,0x33);
  const large=once(ws,'message');
  ws.send(data);
  assert.deepEqual((await large)[0],data);
  ws.close();
  await once(ws,'close');
} finally {
  await gateway.close();
  await new Promise(resolve=>tcp.close(resolve));
}
const id='ssh_0d94c3b5-87b4-4c1e-a444-a24c1da6780e';
const username='abv_012345abcdef';
const password='x'.repeat(43);
const desired={format:'abess-managed-ssh-ws-v1',observedAt:new Date().toISOString(),accounts:[
  {id,username,password,expiresAt:new Date(Date.now()+86400000).toISOString(),enabled:true}
]};
const users=new Set(),calls=[];
const host={
  exists(name){return users.has(name);},
  create(name){calls.push('create');users.add(name);},
  password(name,value){calls.push('password');assert.equal(value,password);},
  enable(){calls.push('enable');},
  disable(){calls.push('disable');}
};
let first=await reconcile(desired,{},host);
assert.deepEqual(first.reports,[{id,state:'active'}]);
assert.deepEqual(calls,['create','password','enable']);
let again=await reconcile(desired,first.state,host);
assert.equal(again.reports[0].state,'active');
assert.deepEqual(calls,['create','password','enable'],'idempotent polls do not change password');
const stopped=await reconcile({...desired,accounts:[{...desired.accounts[0],enabled:false,password:undefined}]},again.state,host);
assert.equal(stopped.reports[0].state,'blocked');
assert.ok(calls.includes('disable'));
const previousCount=calls.length;
failClosedOffline({state:first.state,lastSuccessfulAt:Date.now()-700000},host,Date.now(),600000);
assert.equal(calls.length,previousCount+1,'offline TTL locks active account');
assert.throws(()=>validateDesired({...desired,accounts:[{...desired.accounts[0],username:'root'}]}));
assert.throws(()=>validateDesired({...desired,accounts:[{...desired.accounts[0],password:'bad'}]}));
assert.throws(()=>httpsOrigin('http://panel.example.test'));
assert.equal(httpsOrigin('https://panel.example.test').hostname,'panel.example.test');
const mockRequests=[];
const request=async(url,options)=>{
  mockRequests.push({url:String(url),method:options.method,auth:options.headers.Authorization,body:options.body});
  return {ok:true,json:async()=>desired};
};
// In the real agent, the locally tracked ownership state is persisted between polls.
const store={state:first.state,lastSuccessfulAt:0};
await syncOnce({
  CONTROL_API_BASE_URL:'https://panel.example.test',VPN_NODE_ID:'0d94c3b5-87b4-4c1e-a444-a24c1da6780e',
  VPN_NODE_KEY:'ci-only-node-key'
},request,host,store);
assert.equal(mockRequests.length,2);
assert.ok(mockRequests[0].url.endsWith('/ssh-ws/desired'));
assert.ok(mockRequests[1].url.endsWith('/ssh-ws/status'));
assert.ok(mockRequests[0].auth.includes('ci-only-node-key'));
assert.equal(JSON.parse(mockRequests[1].body).reports[0].state,'active');
console.log('SSH-WS gateway and managed-account reconciling tests passed.');

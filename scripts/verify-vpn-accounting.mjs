// Compare independently counted encrypted SSH bytes with the live relay and API.
// Only the short-lived admin-owned performance canary is read or charged.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import assert from 'node:assert/strict';
import {Duplex} from 'node:stream';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from 'ssh2';
import {WebSocket,createWebSocketStream} from 'ws';
import {sleep,download,upload,RateLimiter} from './vpn-performance-common.mjs';

const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),sessions=[];
const run=process.env.GITHUB_RUN_ID,origin=process.env.VPN_DOMAIN;
assert(/^\d+$/.test(run)&&/^[A-Za-z0-9.-]+$/.test(origin||''));
assert(c.username.startsWith('abv_perf_')&&c.vpnPath.startsWith('/')&&!/[\r\n]/.test(c.vpnPath));
const exec=promisify(execFile),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function snapshot(){
  const script='/tmp/abess-accounting-'+run+'/vpn-performance-host.mjs';
  const command='cd "$HOME/abessvpn-server" && node '+quote(script)+' snapshot '+quote(run);
  const {stdout}=await exec(process.env.ABESS_SSH_COMMAND,['-p',process.env.VPS_PORT||'22',process.env.VPS_USER+'@'+process.env.VPS_HOST,command],{timeout:25000,maxBuffer:1024*1024});
  return JSON.parse(stdout);
}
async function transport(kind){
  if(kind==='framed'){
    const ws=new WebSocket('wss://'+c.vpnHost+':'+c.vpnPort+c.vpnPath,{servername:c.vpnSni,perMessageDeflate:false,headers:{'X-Abess-Device-ID':'accounting-'+run+'-'+kind,'X-Abess-Device-Name':'Controle consommation'}});
    const stream=createWebSocketStream(ws);stream.on('error',()=>{});return stream;
  }
  const socket=tls.connect({host:origin,port:443,servername:origin,rejectUnauthorized:true});socket.setNoDelay(true);
  let header=Buffer.alloc(0),ready=false;
  const stream=new Duplex({read(){socket.resume()},write(chunk,encoding,callback){socket.write(chunk,encoding,callback)},destroy(error,callback){socket.destroy();callback(error)}});
  stream.on('error',()=>{});socket.on('error',e=>stream.destroy(e));socket.on('close',()=>stream.destroy());
  socket.once('secureConnect',()=>socket.write(`GET ${c.vpnPath} HTTP/1.1\r\nHost: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Abess-Device-ID: accounting-${run}-${kind}\r\n\r\n`));
  socket.on('data',chunk=>{
    if(!ready){header=Buffer.concat([header,chunk]);const end=header.indexOf('\r\n\r\n');if(end<0){if(header.length>8192)stream.destroy(Error('Oversize upgrade'));return}assert(header.toString('latin1',0,end).startsWith('HTTP/1.1 101'));ready=true;chunk=header.subarray(end+4);header=null}
    if(chunk.length&&!stream.push(chunk))socket.pause();
  });
  return stream;
}
async function connect(kind){
  const stream=await transport(kind),wire={up:0,down:0},client=new Client();
  const write=stream.write.bind(stream);stream.write=(chunk,...args)=>{wire.up+=Buffer.byteLength(chunk);return write(chunk,...args)};
  stream.on('data',chunk=>wire.down+=chunk.length);
  const s={kind,stream,client,wire};sessions.push(s);
  await new Promise((resolve,reject)=>{client.once('ready',resolve);client.once('error',reject);client.connect({sock:stream,username:c.username,password:c.password,readyTimeout:15000,keepaliveInterval:0,hostVerifier:key=>key.equals(Buffer.from(c.hostKey.split(/\s+/)[1],'base64'))})});
  s.server=net.createServer(socket=>{socket.on('error',()=>{});client.forwardOut('127.0.0.1',0,'127.0.0.1',c.port,(error,channel)=>{if(error){socket.destroy();return}channel.on('error',()=>socket.destroy());socket.pipe(channel).pipe(socket);socket.on('close',()=>channel.destroy())})});
  await new Promise(r=>s.server.listen(0,'127.0.0.1',r));s.port=s.server.address().port;return s;
}
const total=()=>sessions.reduce((a,s)=>({up:a.up+s.wire.up,down:a.down+s.wire.down}),{up:0,down:0});
const deviceTotals=s=>s.local.devices.reduce((a,d)=>({up:a.up+d.upBytes,down:a.down+d.downBytes}),{up:0,down:0});
async function stableSnapshot(){
  for(let i=0;i<8;i++){
    await sleep(1300);const before=total(),s=await snapshot(),after=total();
    if(before.up===after.up&&before.down===after.down)return {...s,wire:after,device:deviceTotals(s)};
  }
  throw Error('No quiet accounting observation window');
}
const delta=(after,before)=>({up:after.up-before.up,down:after.down-before.down});
function assertExact(a,b){const client=delta(a.wire,b.wire),relay=delta(a.device,b.device);assert.deepEqual(relay,client,'Client encrypted SSH bytes must exactly equal both relay directions');assert.equal(a.local.usedBytes-b.local.usedBytes,client.up+client.down,'Licence must equal independently measured bytes');assert.equal(a.local.usedBytes,a.device.up+a.device.down,'Device totals must equal licence');return {client,relay,totalBytes:client.up+client.down}}
async function closeAll(){for(const s of sessions){s.client.end();if(s.server?.listening)s.server.close()}await sleep(600);for(const s of sessions)s.stream.destroy()}
try{
  const initial=await snapshot();assert.equal(initial.local.usedBytes,0);assert.equal(initial.api.usedBytes,0,'Initial report must precede test traffic');
  const raw=await connect('raw'),framed=await connect('framed');
  const before=await stableSnapshot();assert.equal(before.local.online,2);
  const down=8*1024**2,up=4*1024**2;
  await Promise.all([download(raw.port,down),upload(framed.port,up,new RateLimiter(50))]);
  const after=await stableSnapshot(),measured=assertExact(after,before);
  assert(measured.client.down>=down&&measured.client.up>=up);assert(measured.totalBytes<(down+up)*1.06,'Overhead unexpectedly large');
  // No timer-based invented consumption: account remains unchanged without wire bytes.
  await sleep(1500);const idle=await stableSnapshot();assertExact(idle,after);
  await closeAll();let persisted;
  for(let i=0;i<20;i++){persisted=await snapshot();if(persisted.local.online===0&&persisted.api.online===0&&persisted.api.usedBytes===persisted.local.usedBytes)break;await sleep(1500)}
  assert.equal(persisted.api.usedBytes,persisted.local.usedBytes,'API must persist the exact local counter');assert.equal(persisted.api.online,0);assert.equal(persisted.durableBytes,persisted.local.usedBytes,'Clean close must refund unused durable reservations');
  assert.equal(persisted.api.devices.reduce((n,d)=>n+d.usedBytes,0),persisted.api.usedBytes);
  assert.equal(persisted.history.days.reduce((n,d)=>n+d.bytes,0),persisted.api.usedBytes,'Daily history must count every byte once from observed zero');
  const prior=await stableSnapshot();const again=await connect('framed');await download(again.port,1024**2);const reconnected=await stableSnapshot();assert(reconnected.local.usedBytes>prior.local.usedBytes,'Reconnect cannot reset consumption');await closeAll();
  assert.equal(persisted.service.MainPID,initial.service.MainPID,'Accounting check must not restart VPN');
  console.log('VPN_REAL_ACCOUNTING_VERIFIED='+JSON.stringify({applicationBytes:{download:down,upload:up},...measured,overheadBytes:measured.totalBytes-down-up,simultaneousSessions:2,rawAndCloudFrontFramed:true,integrityVerified:true,idleClientBytes:delta(idle.wire,after.wire),idleAccountBytes:idle.local.usedBytes-after.local.usedBytes,apiExactBytes:persisted.api.usedBytes,deviceSumExact:true,dailyHistoryExact:true,cleanCloseNoReservationOvercharge:true,reconnectCounterIncreased:true,relayPidUnchanged:true}));
}finally{await closeAll()}

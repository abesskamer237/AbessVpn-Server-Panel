// Bounded benchmark traffic only. No production credentials or customer data.
import net from 'node:net';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const block=Buffer.concat(Array.from({length:2048},(_,i)=>crypto.createHash('sha256').update('abess-benchmark-v1:'+i).digest()));
const hashes=new Map();
export function digestFor(bytes){if(!hashes.has(bytes)){const h=crypto.createHash('sha256');for(let n=0;n<bytes;n+=block.length)h.update(block.subarray(0,Math.min(block.length,bytes-n)));hashes.set(bytes,h.digest('hex'));}return hashes.get(bytes);}
export class RateLimiter{
  constructor(mbps=100){if(!Number.isFinite(mbps)||mbps<1||mbps>125)throw Error('Unsafe benchmark rate');this.mbps=mbps;this.next=0;}
  async take(bytes){const now=performance.now(),at=Math.max(now,this.next);this.next=at+bytes*8/(this.mbps*1000);if(at>now)await sleep(Math.ceil(at-now));}
}
export class Reader{
  constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.ended=false;this.waiter=null;socket.on('data',c=>{this.buffer=Buffer.concat([this.buffer,c]);this.check()});socket.on('error',e=>{this.error=e;this.check()});socket.on('close',()=>{this.ended=true;this.check()});}
  check(){if(!this.waiter)return;const {size,line,resolve,reject,timer}=this.waiter;const end=line?this.buffer.indexOf(10)+1:size;if(end>0&&this.buffer.length>=end){const value=this.buffer.subarray(0,end);this.buffer=this.buffer.subarray(end);this.waiter=null;clearTimeout(timer);resolve(value);return;}if(this.error||this.ended){this.waiter=null;clearTimeout(timer);reject(this.error||Error('Benchmark stream closed'));}else if(line&&this.buffer.length>1024){this.waiter=null;clearTimeout(timer);reject(Error('Oversize benchmark header'));}}
  read(size,line=false,timeout=10000){if(this.waiter)throw Error('Concurrent benchmark read');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiter=null;this.socket.destroy();reject(Error('Benchmark read timed out'))},timeout);this.waiter={size,line,resolve,reject,timer};this.check()});}
  line(){return this.read(0,true).then(b=>b.toString().trim());}
}
export const write=(s,b)=>new Promise((resolve,reject)=>s.write(b,e=>e?reject(e):resolve()));
export async function open(port){const s=net.createConnection({host:'127.0.0.1',port});s.setNoDelay(true);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('error',reject)});return new Reader(s);}
export async function download(port,bytes){const r=await open(port);try{r.socket.write('DOWNLOAD '+bytes+'\n');if(await r.line()!=='READY')throw Error('Download rejected');const h=crypto.createHash('sha256'),start=performance.now();for(let n=0;n<bytes;n+=65536)h.update(await r.read(Math.min(65536,bytes-n)));const seconds=(performance.now()-start)/1000;if(h.digest('hex')!==digestFor(bytes))throw Error('Download integrity failure');return Number((bytes*8/seconds/1e6).toFixed(2));}finally{r.socket.destroy()}}
export async function upload(port,bytes,limiter=new RateLimiter()){const r=await open(port);try{r.socket.write('UPLOAD '+bytes+'\n');if(await r.line()!=='READY')throw Error('Upload rejected');const start=performance.now();for(let n=0;n<bytes;n+=block.length){const b=block.subarray(0,Math.min(block.length,bytes-n));await limiter.take(b.length);await write(r.socket,b);}if(await r.line()!=='OK '+digestFor(bytes))throw Error('Upload integrity failure');return Number((bytes*8/((performance.now()-start)/1000)/1e6).toFixed(2));}finally{r.socket.destroy()}}
export async function openEcho(port){const r=await open(port);r.socket.write('ECHO\n');if(await r.line()!=='READY')throw Error('Echo rejected');return r;}
export async function ping(r,sequence=0){const b=Buffer.alloc(32,83);b.writeUInt32BE(sequence>>>0);const t=performance.now();await write(r.socket,b);if(!(await r.read(b.length)).equals(b))throw Error('Echo integrity failure');return Number((performance.now()-t).toFixed(2));}
export function stats(values){const a=[...values].sort((x,y)=>x-y);if(!a.length)return {samples:0};const middle=Math.floor(a.length/2),median=a.length%2?a[middle]:(a[middle-1]+a[middle])/2;return {samples:a.length,min:a[0],median:Number(median.toFixed(2)),p95:a[Math.max(0,Math.ceil(a.length*.95)-1)],max:a.at(-1)};}
export async function startTrafficServer({rateMbps=100,budgetBytes=512*1024**2}={}){
  const limiter=new RateLimiter(rateMbps),sockets=new Set();let spent=0,errors=0;
  const server=net.createServer(socket=>{sockets.add(socket);socket.setNoDelay(true);socket.setTimeout(240000,()=>socket.destroy());socket.on('close',()=>sockets.delete(socket));const r=new Reader(socket);
    void(async()=>{try{
      const command=await r.line();
      if(command==='ECHO'){socket.write('READY\n');while(!socket.destroyed){const b=await r.read(32,false,240000);await write(socket,b);}return;}
      const m=/^(DOWNLOAD|UPLOAD) ([0-9]+)$/.exec(command);if(!m)throw Error('Invalid benchmark command');const size=Number(m[2]);if(!Number.isSafeInteger(size)||size<1||size>32*1024**2||spent+size>budgetBytes)throw Error('Benchmark budget exceeded');spent+=size;
      socket.write('READY\n');
      if(m[1]==='DOWNLOAD'){for(let n=0;n<size;n+=block.length){const b=block.subarray(0,Math.min(block.length,size-n));await limiter.take(b.length);await write(socket,b);}}
      else{const h=crypto.createHash('sha256');for(let n=0;n<size;n+=65536)h.update(await r.read(Math.min(65536,size-n)));if(h.digest('hex')!==digestFor(size))throw Error('Upload integrity failure');socket.write('OK '+digestFor(size)+'\n');}
      socket.end();
    }catch{if(!socket.destroyed){errors++;socket.destroy();}}})();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {port:server.address().port,server,status:()=>({bytesRequested:spent,connections:sockets.size,errors}),async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}

import assert from 'node:assert/strict';
import {startTrafficServer,download,upload,openEcho,ping,stats,RateLimiter} from './vpn-performance-common.mjs';
const server=await startTrafficServer({rateMbps:20,budgetBytes:8*1024**2});
try{
  const down=await download(server.port,1024**2),up=await upload(server.port,1024**2,new RateLimiter(20));assert(down>5&&down<40);assert(up>5&&up<40);
  const r=await openEcho(server.port),times=[];for(let i=0;i<10;i++)times.push(await ping(r,i));r.socket.destroy();assert.equal(stats(times).samples,10);
  await assert.rejects(download(server.port,33*1024**2));
  console.log('Performance harness passed: bounded upload/download, byte integrity, latency probes, oversize rejection.');
}finally{await server.close()}

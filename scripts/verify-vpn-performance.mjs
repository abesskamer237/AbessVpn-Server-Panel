// External runner: direct SSH baseline vs actual public TLS/raw and RFC6455.
// No automatic reconnection. Generated test traffic is capped at 100 Mbps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {sleep,download,upload,openEcho,ping,stats,RateLimiter} from './vpn-performance-common.mjs';

if(process.argv[2]==='--bridge'){
  const [file,origin,route,kind,device]=process.argv.slice(3),c=JSON.parse(fs.readFileSync(file,'utf8'));
  const domain=route==='edge'?c.vpnHost:origin,sni=route==='edge'?c.vpnSni:origin,port=route==='edge'?c.vpnPort:443;
  assert(/^[a-zA-Z0-9.-]+$/.test(domain)&&/^[a-zA-Z0-9.-]+$/.test(sni));assert(c.vpnPath.startsWith('/')&&!/[\r\n]/.test(c.vpnPath));
  if(kind==='framed'){
    const {WebSocket,createWebSocketStream}=createRequire(import.meta.url)('ws');
    const ws=new WebSocket('wss://'+domain+':'+port+c.vpnPath,{servername:sni,perMessageDeflate:false,headers:{'X-Abess-Device-ID':device,'X-Abess-Device-Name':'Controle performance'}});
    const stream=createWebSocketStream(ws);ws.on('error',e=>{console.error('PERF_WS_ERROR='+(e.code||/Unexpected server response: (\d+)/.exec(e.message)?.[1]||'handshake'));process.exit(1)});ws.on('close',()=>process.exit(0));stream.on('error',()=>process.exit(1));process.stdin.pipe(stream).pipe(process.stdout);
  }else{
    const socket=tls.connect({host:domain,port,servername:sni,rejectUnauthorized:true});let header=Buffer.alloc(0),ready=false;
    socket.once('secureConnect',()=>socket.write(`GET ${c.vpnPath} HTTP/1.1\r\nHost: ${domain}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Abess-Device-ID: ${device}\r\nX-Abess-Device-Name: Controle performance\r\n\r\n`));
    socket.setTimeout(10000,()=>socket.destroy());
    socket.on('data',chunk=>{if(ready){if(!process.stdout.write(chunk))socket.pause();return;}header=Buffer.concat([header,chunk]);const end=header.indexOf('\r\n\r\n');if(end<0){if(header.length>8192)socket.destroy();return;}if(!header.toString('latin1',0,end).startsWith('HTTP/1.1 101')){socket.destroy();return;}ready=true;socket.setTimeout(0);if(header.length>end+4)process.stdout.write(header.subarray(end+4));header=null;process.stdin.pipe(socket)});
    process.stdout.on('drain',()=>socket.resume());socket.on('error',e=>{console.error('PERF_TLS_ERROR='+(e.code||'connection'));process.exit(1)});socket.on('close',()=>process.exit(0));
  }
}else{
  const credentialsFile=process.argv[2],credentials=JSON.parse(fs.readFileSync(credentialsFile,'utf8')),domain=process.env.VPN_DOMAIN;
  if(process.env.VPN_EDGE_OVERRIDE){const edge=process.env.VPN_EDGE_OVERRIDE.toLowerCase();assert(/^d[a-z0-9]+\.cloudfront\.net$/.test(edge));credentials.vpnHost=edge;credentials.vpnSni=edge;fs.writeFileSync(credentialsFile,JSON.stringify(credentials),{mode:0o600});}
  assert(/^[a-zA-Z0-9.-]+$/.test(domain||''));assert(credentials.port>0&&credentials.username.startsWith('abv_perf_'));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'abess-performance-client-')),children=[],report={scope:'external Internet runner to VPS; not Orange Cameroon',rateCapMbps:100,cases:{},parallel:{},stability:{}};
  const script=fileURLToPath(import.meta.url),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  fs.writeFileSync(directory+'/askpass','#!/bin/sh\nprintf "%s" "$ABESS_PERFORMANCE_PASSWORD"\n',{mode:0o700});
  fs.writeFileSync(directory+'/known_hosts','abess-performance,[abess-performance]:443 '+credentials.hostKey+'\n',{mode:0o600});
  async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
  async function launch(kind,label,route='origin'){
    const port=await freePort();let executable,args;
    const common=['-N','-o','Compression=no','-o','ExitOnForwardFailure=yes','-o','ConnectionAttempts=1','-o','ConnectTimeout=10','-o','LogLevel=ERROR','-L',`127.0.0.1:${port}:127.0.0.1:${credentials.port}`];
    if(kind==='direct'){
      executable=process.env.ABESS_SSH_COMMAND;assert(executable&&process.env.VPS_HOST&&process.env.VPS_USER);
      args=['-p',process.env.VPS_PORT||'22',...common,process.env.VPS_USER+'@'+process.env.VPS_HOST];
    }else{
      executable='ssh';const bridge=[process.execPath,script,'--bridge',credentialsFile,domain,route,kind,'perf-'+process.env.GITHUB_RUN_ID+'-'+label].map(quote).join(' ');
      args=['-p','443',...common,'-o','ServerAliveInterval=0','-o','HostKeyAlias=abess-performance','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+directory+'/known_hosts','-o','PreferredAuthentications=password','-o','PubkeyAuthentication=no','-o','NumberOfPasswordPrompts=1','-o','ProxyCommand='+bridge,credentials.username+'@abess-performance'];
    }
    const childEnv={...process.env};
    if(kind!=='direct'){
      Object.assign(childEnv,{DISPLAY:'abess-performance',SSH_ASKPASS:directory+'/askpass',SSH_ASKPASS_REQUIRE:'force',ABESS_PERFORMANCE_PASSWORD:credentials.password});
      for(const key of ['VPS_SSH_PASSWORD','VPS_PASSWORD','VPS_SSH_KEY','SSHPASS'])delete childEnv[key];
    }
    const child=spawn(executable,args,{stdio:['ignore','ignore','pipe'],env:childEnv});
    child.diagnostic='';child.stderr.on('data',c=>child.diagnostic=(child.diagnostic+c.toString()).slice(-1000));children.push(child);
    let echo;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null||child.signalCode!==null)throw Error('Benchmark SSH '+kind+' failed: '+child.diagnostic);
      try{echo=await openEcho(port);break}catch{await sleep(200)}
    }
    assert(echo,'Benchmark SSH forward did not become ready');
    return {kind,label,route,port,child,echo,latencies:[],startedAt:Date.now()};
  }
  const check=s=>{if(s.child.exitCode!==null||s.child.signalCode!==null)throw Error('Unexpected SSH disconnect: '+s.label)};
  const measurePings=async(s,n)=>{for(let i=0;i<n;i++){check(s);s.latencies.push(await ping(s.echo,s.latencies.length));await sleep(30)}};
  const stop=s=>{s.echo.socket.destroy();s.child.kill('SIGTERM')};
  try{
    const start=Date.now(),sessions=[];let baseline;
    const edgeDifferent=credentials.vpnHost!==domain;let edgeSupported=!edgeDifferent;
    const cases=[['direct','direct','origin'],['originRaw','raw','origin'],['originFramed','framed','origin'],...(edgeDifferent?[['clientEdgeFramed','framed','edge']]:[])];
    for(const [label,kind,route] of cases){
      let s;try{s=await launch(kind,label,route)}catch(e){if(route!=='edge')throw e;report.cases[label]={connectionFailed:true,error:e.message};console.log('VPN_ROUTE_FAILURE='+JSON.stringify({transport:label,error:e.message}));continue;}
      await measurePings(s,20);const down=[],up=[];
      for(let round=0;round<3;round++){down.push(await download(s.port,16*1024**2));up.push(await upload(s.port,16*1024**2,new RateLimiter(100)));check(s);}
      report.cases[label]={downloadMbps:stats(down),uploadMbps:stats(up),roundTripMs:stats(s.latencies),integrityVerified:true};
      console.log('VPN_THROUGHPUT_CASE='+JSON.stringify({transport:label,...report.cases[label]}));
      if(kind==='direct')baseline=s;
      else if(label==='clientEdgeFramed'){edgeSupported=true;const old=sessions.find(x=>x.label==='originFramed');if(old){stop(old);sessions.splice(sessions.indexOf(old),1)}sessions.push(s);}
      else sessions.push(s);
    }
    const parallel=await Promise.all(Array.from({length:4},(_,i)=>launch(i%2?'framed':'raw','parallel-'+i,i%2&&edgeDifferent&&edgeSupported?'edge':'origin')));
    const underLoad=Object.fromEntries([baseline,...sessions].map(s=>[s.label,[]]));let loading=true,loadError;
    const loadProbe=(async()=>{while(loading){for(const s of [baseline,...sessions]){try{underLoad[s.label].push(await ping(s.echo,underLoad[s.label].length))}catch(e){loadError=e;loading=false;return}}await sleep(100)}})();
    try{const t=performance.now();const speeds=await Promise.all(parallel.map(s=>download(s.port,8*1024**2)));parallel.forEach(check);loading=false;await loadProbe;if(loadError)throw loadError;report.parallel={connections:4,protocols:['raw','framed'],aggregateDownloadMbps:Number((32*1024**2*8/((performance.now()-t)/1000)/1e6).toFixed(2)),individualMbps:speeds,roundTripUnderLoadMs:Object.fromEntries(Object.entries(underLoad).map(([k,v])=>[k,stats(v)])),integrityVerified:true};console.log('VPN_PARALLEL='+JSON.stringify(report.parallel));}finally{loading=false;await loadProbe;parallel.forEach(stop);stop(baseline)}
    const activeStart=Date.now();let pings=0;
    while(Date.now()-activeStart<90000){for(const s of sessions){check(s);s.latencies.push(await ping(s.echo,pings++));}if(pings%30===0)await download(sessions[pings%2].port,1024**2);await sleep(1000)}
    console.log('VPN_STABILITY_PROGRESS='+JSON.stringify({activeSeconds:Math.round((Date.now()-activeStart)/1000),unexpectedDisconnects:0}));
    const idleStart=Date.now();
    while(Date.now()-idleStart<180000){sessions.forEach(check);await sleep(1000)}
    const idleSeconds=Math.round((Date.now()-idleStart)/1000);
    for(const s of sessions){await measurePings(s,20);await download(s.port,1024**2);check(s);}
    report.stability={activeSeconds:Math.round((idleStart-activeStart)/1000),applicationIdleSeconds:idleSeconds,unexpectedDisconnects:0,reconnections:0,resumeAfterIdle:true,sessions:sessions.map(s=>({transport:s.label,lifetimeSeconds:Math.round((Date.now()-s.startedAt)/1000),roundTripMs:stats(s.latencies)})),totalSeconds:Math.round((Date.now()-start)/1000)};
    report.exportedRouteVerified=edgeSupported;
    report.meets30Mbps=edgeSupported&&Object.entries(report.cases).filter(([k,v])=>k!=='direct'&&!v.connectionFailed).every(([,v])=>v.downloadMbps.median>=30&&v.uploadMbps.median>=30);
    console.log('VPN_PERFORMANCE_RESULT='+JSON.stringify(report));
    if(process.env.VPN_PERFORMANCE_REPORT)fs.writeFileSync(process.env.VPN_PERFORMANCE_REPORT,JSON.stringify(report,null,2));
  }finally{for(const p of children)if(p.exitCode===null)p.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});}
}

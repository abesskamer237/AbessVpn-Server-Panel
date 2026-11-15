// Root-only temporary benchmark endpoint and canary. Never changes VPN services.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startTrafficServer,sleep} from './vpn-performance-common.mjs';
const mode=process.argv[2],run=process.argv[3];
assert(process.getuid()===0&&/^[a-zA-Z0-9_-]{1,64}$/.test(run||''),'Invalid performance probe context');
const dir='/var/lib/abess-vpn-performance/'+run,stateFile=dir+'/state.json';
const command=(p,args)=>{try{return execFileSync(p,args,{encoding:'utf8',timeout:10000}).trim()}catch{throw Error('Performance host command failed: '+p)}};
const docker=['compose','exec','-T','--interactive=false','api','node','--import','tsx','/app/scripts/strict-probe-session.mjs'];
const auth=()=>JSON.parse(command('docker',[...docker,'create'])).token;
const revoke=token=>{const a=[...docker];a[a.indexOf('--interactive=false')]='--interactive=true';execFileSync('docker',[...a,'revoke'],{input:JSON.stringify({token}),timeout:10000})};
async function api(token,route,method='GET',body){const r=await fetch('http://127.0.0.1:3000/api/v1/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Performance canary API '+method+' '+route+' HTTP '+r.status);return r.status===204?null:r.json();}
function section(file,name){const lines=fs.readFileSync(file,'utf8').split('\n');for(let i=0;i<lines.length-1;i++)if(lines[i].startsWith(name+':'))return Object.fromEntries(lines[i].split(/\s+/).slice(1).map((k,j)=>[k,Number(lines[i+1].split(/\s+/)[j+1])]));return {};}
function service(){return Object.fromEntries(command('systemctl',['show','abess-raw-meter.service','-p','MainPID','-p','NRestarts','-p','ActiveState']).split('\n').map(l=>l.split('=')));}
function cpu(){const a=fs.readFileSync('/proc/stat','utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);return {total:a.reduce((s,n)=>s+n,0),idle:a[3]+a[4]};}
function memory(){return Object.fromEntries(fs.readFileSync('/proc/meminfo','utf8').split('\n').filter(l=>/^(MemTotal|MemAvailable):/.test(l)).map(l=>{const p=l.split(/\s+/);return [p[0].slice(0,-1),Number(p[1])]}));}
function pressure(name){try{return Number(/some avg10=([0-9.]+)/.exec(fs.readFileSync('/proc/pressure/'+name,'utf8'))?.[1]||0)}catch{return null}}
function nic(){const interfaces=new Set(fs.readFileSync('/proc/net/route','utf8').split('\n').slice(1).filter(l=>l.trim().split(/\s+/)[1]==='00000000').map(l=>l.trim().split(/\s+/)[0]));const result={rx_bytes:0,tx_bytes:0,rx_errors:0,tx_errors:0,rx_dropped:0,tx_dropped:0};for(const n of interfaces)for(const key of Object.keys(result)){try{result[key]+=Number(fs.readFileSync('/sys/class/net/'+n+'/statistics/'+key,'utf8'))}catch{}}return result;}
function rss(pid){try{return Number(/^VmRSS:\s+(\d+)/m.exec(fs.readFileSync('/proc/'+pid+'/status','utf8'))?.[1]||0)/1024}catch{return null}}
function publicTcp(pid){try{return section('/proc/'+pid+'/net/snmp','Tcp')}catch{return {}}}
function processTicks(pid){try{const s=fs.readFileSync('/proc/'+pid+'/stat','utf8');const p=s.slice(s.lastIndexOf(')')+2).split(' ');return {cpu:Number(p[11])+Number(p[12]),start:p[19]}}catch{return {cpu:0,start:null}}}
function fdCount(pid){try{return fs.readdirSync('/proc/'+pid+'/fd').length}catch{return null}}
async function cleanup(){
  if(!fs.existsSync(stateFile))return {alreadyClean:true};const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  let token;try{token=auth();await api(token,'admin/ssh/accounts/'+state.accountId,'DELETE');}catch(e){
    if(!String(e.message).includes('HTTP 404')){
      // A timed-out probe must never leave a usable test account behind.
      if(/^abv_perf_[a-f0-9]{10}$/.test(state.username)){try{command('/usr/sbin/usermod',['--lock','--expiredate','1',state.username])}catch{}}
      throw e;
    }
  }finally{if(token)revoke(token)}
  if(state.pid&&state.pid!==process.pid){try{const cmd=fs.readFileSync('/proc/'+state.pid+'/cmdline','utf8');if(state.pidStart&&processTicks(state.pid).start===state.pidStart&&cmd.includes(fileURLToPath(import.meta.url))&&cmd.includes(run))process.kill(state.pid,'SIGTERM')}catch{}}
  // The daemon writes only aggregate metrics; allow its final sample to flush.
  for(let i=0;i<50&&!fs.existsSync(dir+'/host-report.json');i++)await sleep(100);
  const report=fs.existsSync(dir+'/host-report.json')?JSON.parse(fs.readFileSync(dir+'/host-report.json','utf8')):{warning:'Final host sample unavailable'};
  fs.rmSync(dir,{recursive:true,force:true});return {canaryDeleted:true,...report};
}
if(mode==='setup'){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});let token,account;
  const username='abv_perf_'+crypto.randomBytes(5).toString('hex'),password=crypto.randomBytes(18).toString('hex');
  try{
    token=auth();const node=JSON.parse(fs.readFileSync('/etc/abess-ssh-ws/node-bootstrap.json','utf8'));
    account=await api(token,'admin/ssh/managed','POST',{nodeId:node.id,label:'[Controle performances temporaire]',username,password,days:30,quotaGb:1,maxConnections:6});
    fs.writeFileSync(stateFile,JSON.stringify({accountId:account.id,username}),{mode:0o600});
    let ready=false;for(let i=0;i<80;i++){const inv=await api(token,'admin/ssh');if(inv.accounts.some(a=>a.id===account.id&&a.provisionState==='active')){ready=true;break}await sleep(500)}assert(ready,'Performance canary not provisioned');
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'serve',run],{detached:true,stdio:'ignore',cwd:process.cwd()});child.unref();
    fs.writeFileSync(stateFile,JSON.stringify({accountId:account.id,username,pid:child.pid,pidStart:processTicks(child.pid).start}),{mode:0o600});
    let port;for(let i=0;i<50;i++){try{port=Number(fs.readFileSync(dir+'/port','utf8'));if(port)break}catch{}await sleep(100)}assert(port,'Benchmark listener failed');
    const hostKey=fs.readFileSync('/etc/ssh/ssh_host_ed25519_key.pub','utf8').trim().split(/\s+/).slice(0,2).join(' ');
    const config=await api(token,`admin/ssh/accounts/${account.id}/config`,'POST',{transport:'wss'});
    process.stdout.write(JSON.stringify({username,password,port,hostKey,vpnHost:config.host,vpnSni:config.sni,vpnPort:config.port,vpnPath:config.path}));
  }catch(e){try{await cleanup()}catch{}throw e}finally{if(token)revoke(token)}
}else if(mode==='snapshot'){
  // Scope strictly to this run's synthetic account; no customer data or secrets.
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));let token;
  try{
    token=auth();const inv=await api(token,'admin/ssh');
    const account=inv.accounts.find(a=>a.id===state.accountId);assert(account);
    const devices=await api(token,'admin/ssh/accounts/'+state.accountId+'/devices');
    const history=await api(token,'admin/usage-history?days=7');
    const own=history.accounts.find(a=>a.id===state.accountId);
    const usage=JSON.parse(fs.readFileSync('/var/lib/abess-raw-meter/usage-live.json','utf8'));
    const local=usage.accounts.find(a=>a.id===state.accountId);assert(local);
    const durable=JSON.parse(fs.readFileSync('/var/lib/abess-raw-meter/usage.json.accounts/'+state.accountId+'.json','utf8'));
    const view=d=>({deviceKey:d.deviceKey,usedBytes:d.usedBytes,upBytes:d.upBytes,downBytes:d.downBytes,activeSessions:d.activeSessions});
    process.stdout.write(JSON.stringify({local:{usedBytes:local.usedBytes,online:local.online,devices:local.devices.map(view)},durableBytes:durable.usedBytes,api:{usedBytes:account.usedBytes,online:account.online,usageObservedAt:account.usageObservedAt,devices:devices.map(view)},history:{bytes:own?.bytes,days:own?.days,baselineAt:own?.baselineAt},observedAt:usage.observedAt,service:service()}));
  }finally{if(token)revoke(token)}
}else if(mode==='apply-edge'){
  const edge=String(process.argv[4]||'').toLowerCase();assert(/^d[a-z0-9]+\.cloudfront\.net$/.test(edge));
  const baseline=service();let token,previous,updated=false;const envFile=path.join(process.cwd(),'.env'),temp=envFile+'.edge-'+run;
  try{
    token=auth();const nodeId=JSON.parse(fs.readFileSync('/etc/abess-ssh-ws/node-bootstrap.json','utf8')).id;
    const inventory=await api(token,'admin/ssh');previous=inventory.managedNodes.find(n=>n.id===nodeId);assert(previous,'Managed node missing');
    const fingerprint=command('ssh-keygen',['-lf','/etc/ssh/ssh_host_ed25519_key.pub','-E','sha256']).split(/\s+/)[1];
    const content=fs.readFileSync(envFile,'utf8');const oldLine=content.split('\n').find(l=>l.startsWith('SSH_WS_EDGE_HOST='))||null;
    fs.mkdirSync('/var/lib/abess-edge-backups',{recursive:true,mode:0o700});fs.writeFileSync('/var/lib/abess-edge-backups/'+run+'.json',JSON.stringify({previousSni:previous.sni,previousEnvLine:oldLine,changedAt:new Date().toISOString()}),{mode:0o600});
    const next=content.split('\n').filter(l=>!l.startsWith('SSH_WS_EDGE_HOST=')).join('\n').trimEnd()+'\nSSH_WS_EDGE_HOST='+JSON.stringify(edge)+'\n';
    const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,next);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    const body={enabled:true,fingerprint,sni:edge,port:previous.port,path:previous.path};
    const result=await api(token,'admin/nodes/'+nodeId+'/ssh-ws','PUT',body);assert.equal(result.sshWsSni,edge);updated=true;
    try{fs.renameSync(temp,envFile)}catch(e){await api(token,'admin/nodes/'+nodeId+'/ssh-ws','PUT',{...body,sni:previous.sni});throw e}
    const check=await api(token,'admin/ssh');assert.equal(check.managedNodes.find(n=>n.id===nodeId).sni,edge);
    console.log('VPN_EDGE_UPDATED='+JSON.stringify({hostname:edge,configurationVerified:true,environmentPersisted:true,relayPidUnchanged:baseline.MainPID===service().MainPID}));
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);if(token)revoke(token)}
}else if(mode==='cleanup')console.log('VPN_HOST_PERFORMANCE='+JSON.stringify(await cleanup()));
else if(mode==='serve'){
  const server=await startTrafficServer({rateMbps:100,budgetBytes:512*1024**2});
  const initialService=service(),pid=Number(initialService.MainPID),startNic=nic(),startCpu=cpu(),start=Date.now(),samples=[];
  let caddyPid;try{const id=command('docker',['compose','ps','-q','caddy']);caddyPid=Number(command('docker',['inspect','--format','{{.State.Pid}}',id]))}catch{}
  const startTcp=publicTcp(caddyPid),startOom=Number(/^oom_kill\s+(\d+)/m.exec(fs.readFileSync('/proc/vmstat','utf8'))?.[1]||0);
  const hz=Number(command('getconf',['CLK_TCK'])),initialFd=fdCount(pid);let prior={...startCpu,at:Date.now(),processCpu:processTicks(pid).cpu};
  const sample=()=>{const c=cpu(),m=memory(),at=Date.now(),p=processTicks(pid);samples.push({cpuPercent:100*(1-(c.idle-prior.idle)/Math.max(1,c.total-prior.total)),relayCpuPercent:100*(p.cpu-prior.processCpu)/(hz*Math.max(.001,(at-prior.at)/1000)),relayFd:fdCount(pid),availableMemoryMb:m.MemAvailable/1024,relayRssMb:rss(pid),cpuPressure:pressure('cpu'),ioPressure:pressure('io')});prior={...c,at,processCpu:p.cpu};};
  const timer=setInterval(sample,5000);let stopped=false;
  async function stop(){if(stopped)return;stopped=true;clearInterval(timer);sample();await server.close();const endNic=nic(),endTcp=publicTcp(caddyPid),endService=service();
    let cc=null,settings={};try{cc=command('nsenter',['-t',String(caddyPid),'-n','sysctl','-n','net.ipv4.tcp_congestion_control'])}catch{}
    try{const user=JSON.parse(fs.readFileSync(stateFile,'utf8')).username;const raw=command('/usr/sbin/sshd',['-T','-C','user='+user+',host=localhost,addr=127.0.0.1']);settings=Object.fromEntries(raw.split('\n').map(l=>l.split(/\s+/)).filter(p=>['clientaliveinterval','clientalivecountmax','tcpkeepalive','compression','usedns'].includes(p[0])).map(p=>[p[0],p.slice(1).join(' ')]));}catch{}
    const out=(endTcp.OutSegs||0)-(startTcp.OutSegs||0),retrans=(endTcp.RetransSegs||0)-(startTcp.RetransSegs||0);
    let relayHealthy=false;try{const h=await(await fetch('http://172.18.0.1:8081/healthz',{signal:AbortSignal.timeout(2000)})).json();relayHealthy=h.ok&&h.strict}catch{}
    const report={durationSeconds:Math.round((Date.now()-start)/1000),serviceStillActive:endService.ActiveState==='active',relayHealthy,relayPidUnchanged:initialService.MainPID===endService.MainPID,relayRestarts:Number(endService.NRestarts)-Number(initialService.NRestarts),relayCpuMaxPercent:Number(Math.max(...samples.map(s=>s.relayCpuPercent)).toFixed(1)),relayFd:{before:initialFd,max:Math.max(...samples.map(s=>s.relayFd||0)),after:fdCount(pid)},cpuMaxPercent:Number(Math.max(...samples.map(s=>s.cpuPercent)).toFixed(1)),cpuAveragePercent:Number((samples.reduce((n,s)=>n+s.cpuPercent,0)/samples.length).toFixed(1)),memoryAvailableMinMb:Math.round(Math.min(...samples.map(s=>s.availableMemoryMb))),relayRssMaxMb:Math.round(Math.max(...samples.map(s=>s.relayRssMb||0))),cpuPressureMax:Math.max(...samples.map(s=>s.cpuPressure||0)),ioPressureMax:Math.max(...samples.map(s=>s.ioPressure||0)),publicTlsCongestionControl:cc,publicTlsSegments:out,publicTlsRetransmissions:retrans,publicTlsRetransmitPercent:out>0?Number((100*retrans/out).toFixed(3)):null,interfaceErrors:Object.fromEntries(['rx_errors','tx_errors','rx_dropped','tx_dropped'].map(k=>[k,endNic[k]-startNic[k]])),oomKills:Number(/^oom_kill\s+(\d+)/m.exec(fs.readFileSync('/proc/vmstat','utf8'))?.[1]||0)-startOom,managedSshSettings:settings,benchmark:server.status()};
    fs.writeFileSync(dir+'/host-report.json',JSON.stringify(report),{mode:0o600});
  }
  process.once('SIGTERM',()=>{stop().then(()=>process.exit(0)).catch(()=>process.exit(1))});
  const expiry=setTimeout(()=>{stop().then(()=>cleanup()).then(()=>process.exit(0)).catch(()=>process.exit(1))},12*60000);expiry.unref();
  fs.writeFileSync(dir+'/port',String(server.port),{mode:0o600});
}else throw Error('Unknown performance probe command');

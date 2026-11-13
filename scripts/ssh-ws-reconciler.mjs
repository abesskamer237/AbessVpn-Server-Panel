/**
 * Privileged host reconciler for ABESS-owned OpenSSH accounts.
 * NEVER executes arbitrary commands received from the panel.
 * Node 22+, Debian/Ubuntu host; group "abessvpn" must be provisioned first.
 */
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {validSourceIp} from './ssh-ws-quota.mjs';

const usernamePattern=/^abv_[a-z0-9][a-z0-9_-]{2,27}$/;
const accountIdPattern=/^ssh_[a-f0-9-]{36}$/;
export function validateDesired(manifest) {
  if (manifest?.format!=='abess-managed-ssh-ws-v1' ||
      !Array.isArray(manifest.accounts) || manifest.accounts.length>2000)
    throw Error('Invalid SSH-WS manifest');
  const usernames=new Set(), ids=new Set();
  for(const a of manifest.accounts) {
    if(!a || !usernamePattern.test(a.username) || !accountIdPattern.test(a.id) ||
       usernames.has(a.username) || ids.has(a.id) || typeof a.enabled!=='boolean' ||
       !Number.isFinite(Date.parse(a.expiresAt)) ||
       !Number.isSafeInteger(a.quotaBytes) || a.quotaBytes<1 ||
       !Number.isSafeInteger(a.baselineUsedBytes) || a.baselineUsedBytes<0 ||
       !Number.isInteger(a.maxConnections) || a.maxConnections<1 || a.maxConnections>10 ||
       (a.enabled && (!/^[a-f0-9]{64}$/.test(a.tokenHash) ||
         typeof a.password!=='string' || !/^[A-Za-z0-9@#$%&*+=._-]{8,96}$/.test(a.password))))
       throw Error('Invalid SSH-WS account');
    usernames.add(a.username);ids.add(a.id);
  }
  return manifest.accounts;
}
export function command(program,args,input) {
  const r=spawnSync(program,args,{encoding:'utf8',input,timeout:10000,maxBuffer:65536});
  if(r.error || r.status!==0)throw Error('Host operation failed: '+program.split('/').pop());
  return r.stdout;
}
export function hostOperations(run=command) {
  const group='abessvpn';
  function exists(username) {try {run('/usr/bin/id',['-u',username]);return true;}catch{return false;}}
  function check(username) {
    if(run('/usr/bin/id',['-gn',username]).trim()!==group)throw Error('Account not in managed group');
  }
  return {
    exists,
    create(username) {
      if(exists(username))throw Error('Refusing to adopt existing Linux account');
      run('/usr/sbin/useradd',['--no-create-home','--gid',group,'--shell','/usr/sbin/nologin',username]);
    },
    password(username,secret) {
      check(username);run('/usr/sbin/chpasswd',[],username+':'+secret+'\n');
    },
    enable(username) {
      check(username);run('/usr/sbin/usermod',['--unlock','--expiredate','-1',username]);
    },
    disable(username) {
      if(!exists(username))return;
      check(username);
      run('/usr/sbin/usermod',['--lock','--expiredate','1',username]);
      const uid=run('/usr/bin/id',['-u',username]).trim();
      if(!/^[0-9]{1,8}$/.test(uid)||Number(uid)<1000)throw Error('Refusing unsafe UID');
      try{run('/usr/bin/pkill',['-KILL','-u',uid]);}catch{ /* no SSH processes */ }
    }
  };
}
export async function reconcile(manifest,previous={},host=hostOperations()) {
  const accounts=validateDesired(manifest);
  const state={...previous},reports=[];
  const present=new Set(accounts.map(a=>a.username));
  // Once allocated, a user's loopback identity is never reused by another user.
  const allocated=new Set(Object.values(state).map(v=>v?.sourceIp).filter(validSourceIp));
  const allocate=old=>{
    if(validSourceIp(old?.sourceIp))return old.sourceIp;
    for(let slot=0;slot<256*254;slot++){
      const candidate='127.120.'+Math.floor(slot/254)+'.'+(slot%254+1);
      if(!allocated.has(candidate)){allocated.add(candidate);return candidate;}
    }
    throw Error('SSH-WS source address pool exhausted');
  };
  for(const a of accounts) {
    const old=previous[a.username];
    try {
      const sourceIp=allocate(old);
      if(old && old.id!==a.id)throw Error('Account id changed unexpectedly');
      if(!old && host.exists(a.username))throw Error('Existing unmanaged Linux user');
      const enabled=a.enabled && Date.parse(a.expiresAt)>Date.now();
      if(enabled) {
        const missing=!host.exists(a.username);
        if(missing)host.create(a.username);
        // Record ownership immediately in case chpasswd or account activation fails.
        state[a.username]={id:a.id,sourceIp,passwordHash:old?.passwordHash||null,enabled:false,expiresAt:a.expiresAt};
        const hash=crypto.createHash('sha256').update(a.password).digest('hex');
        // A manually deleted user must receive its password again even if it
        // was already present in the previous local state snapshot.
        if(missing || old?.passwordHash!==hash)host.password(a.username,a.password);
        if(missing || !old?.enabled || old.passwordHash!==hash)host.enable(a.username);
        state[a.username]={id:a.id,sourceIp,passwordHash:hash,enabled:true,expiresAt:a.expiresAt};
      } else {
        if(!old || old.enabled)host.disable(a.username);
        state[a.username]={id:a.id,sourceIp,passwordHash:old?.passwordHash||null,enabled:false,expiresAt:a.expiresAt};
      }
      reports.push({id:a.id,state:enabled?'active':'blocked'});
    } catch {
      try{host.disable(a.username);}catch{}
      if(state[a.username])state[a.username].enabled=false;
      reports.push({id:a.id,state:'error'});
    }
  }
  // A license removed from the inventory must never remain active locally.
  for(const [username,tracked] of Object.entries(previous)) {
    if(!present.has(username) && usernamePattern.test(username)) {
      try {host.disable(username);state[username]={...tracked,enabled:false};}
      catch { /* retry on next cycle */ }
    }
  }
  return {state,reports};
}
export function httpsOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password ||
     url.pathname!=='/' || url.search || url.hash)throw Error('HTTPS panel required');
  return url;
}
function policyAccounts(desired,report) {
  const states=new Map(report.reports.map(x=>[x.id,x.state]));
  return desired.accounts.filter(a=>/^[a-f0-9]{64}$/.test(a.tokenHash)).map(a=>({
    id:a.id,username:a.username,sourceIp:report.state[a.username]?.sourceIp,tokenHash:a.tokenHash,
    enabled:a.enabled && states.get(a.id)==='active',
    expiresAt:a.expiresAt,
    quotaBytes:a.quotaBytes,baselineUsedBytes:a.baselineUsedBytes,
    maxConnections:a.maxConnections,blockedDevices:Array.isArray(a.blockedDevices)?a.blockedDevices:[]
  }));
}
async function persist(file,store,mode=0o600,gid=null) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
  const fd=await fs.open(temp,'wx',mode);
  try {
    await fd.writeFile(JSON.stringify(store));
    await fd.sync();
    if(gid!==null)await fd.chown(0,gid);
    await fd.chmod(mode);
  } finally {await fd.close();}
  try{
    await fs.rename(temp,file);
    const dir=await fs.open(path.dirname(file),'r');
    try{await dir.sync();}finally{await dir.close();}
  }catch(error){
    await fs.rm(temp,{force:true}).catch(()=>{});
    throw error;
  }
}
/** OpenSSH enforces the SSH username matching the WSS licence identity. */
export function allowedUsersConfig(policy) {
  if(!Array.isArray(policy?.accounts))throw Error('Invalid managed SSH policy');
  const lines=['# Generated by ABESS. Do not edit.',
    '# No wildcard: a WSS token must never authenticate as another SSH user.'];
  const active=policy.accounts.filter(a=>a.enabled);
  for(const a of active){
    if(!usernamePattern.test(a.username)||!validSourceIp(a.sourceIp))
      throw Error('Invalid SSH identity binding');
    lines.push('AllowUsers '+a.username+'@'+a.sourceIp);
  }
  if(!active.length)lines.push('AllowUsers _abess_no_active_user_');
  return lines.join('\n')+'\n';
}
async function configureSshdAccess(env,store,policy) {
  if(typeof store.configureSshd==='function')return store.configureSshd(allowedUsersConfig(policy));
  const file=env.SSH_WS_ALLOW_USERS_FILE;
  if(file!=='/etc/abess-ssh-ws/allowed-users.conf')throw Error('Unsafe SSHD allowlist destination');
  const payload=allowedUsersConfig(policy);
  const previous=await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
  if(previous===payload)return;
  const temp=file+'.'+process.pid+'.tmp';
  await fs.writeFile(temp,payload,{mode:0o600,flag:'wx'});
  try {
    await fs.rename(temp,file);
    command('/usr/sbin/sshd',['-t','-f','/etc/abess-ssh-ws/sshd_config']);
    command('/usr/bin/systemctl',['kill','-s','HUP','--kill-who=main','abess-ssh-ws-sshd.service']);
  }catch(e){
    await fs.writeFile(file,previous,{mode:0o600});
    throw e;
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
async function publishPolicy(env,store,policy) {
  if(typeof store.writePolicy==='function')return store.writePolicy(policy);
  const file=env.SSH_WS_POLICY_FILE;
  const gid=Number(env.SSH_WS_GATEWAY_GID);
  if(!file || !Number.isInteger(gid) || gid<1)throw Error('Gateway policy directory/GID missing');
  return persist(file,policy,0o640,gid);
}
async function readUsage(env,store,policyTime) {
  let usage;
  try{
    usage=typeof store.readUsage==='function'
      ? await store.readUsage(policyTime)
      : JSON.parse(await fs.readFile(env.SSH_WS_USAGE_REPORT_FILE,'utf8'));
  }catch{return null;}
  if(usage?.format!=='abess-ssh-ws-usage-v1' ||
     usage.policyObservedAt!==policyTime ||
     !Array.isArray(usage.accounts) ||
     Date.now()-Date.parse(usage.observedAt)>15000 ||
     Date.parse(usage.observedAt)>Date.now()+5000) return null;
  const seen=new Set();
  for(const a of usage.accounts){
    if(!a || !accountIdPattern.test(a.id) || seen.has(a.id) ||
       !Number.isSafeInteger(a.usedBytes) || a.usedBytes<0 ||
       !Number.isInteger(a.online) || a.online<0 || a.online>5000 ||
       (a.devices!==undefined && (!Array.isArray(a.devices) || a.devices.length>50 || a.devices.some(d=>!d||!/^[a-f0-9]{32}$/.test(String(d.deviceKey||''))||!Number.isSafeInteger(Number(d.usedBytes||0))||Number(d.usedBytes||0)<0||!Number.isSafeInteger(Number(d.upBytes||0))||Number(d.upBytes||0)<0||!Number.isSafeInteger(Number(d.downBytes||0))||Number(d.downBytes||0)<0))))return null;
    seen.add(a.id);
  }
  return usage;
}
let previousCpuSample=null;
async function hostTelemetry() {
  let diskTotalBytes=0,diskFreeBytes=0,cpuPercent=0;
  try {
    const stat=await fs.statfs('/');
    diskTotalBytes=Number(stat.blocks)*Number(stat.bsize);
    diskFreeBytes=Number(stat.bavail)*Number(stat.bsize);
  } catch {}
  try {
    const first=(await fs.readFile('/proc/stat','utf8')).split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    if(first.length>=8&&first.every(Number.isFinite)){
      const idle=(first[3]||0)+(first[4]||0),total=first.reduce((a,b)=>a+b,0);
      if(previousCpuSample){
        const dt=total-previousCpuSample.total,di=idle-previousCpuSample.idle;
        if(dt>0)cpuPercent=Math.max(0,Math.min(100,Number((((dt-di)/dt)*100).toFixed(1))));
      }
      previousCpuSample={total,idle};
    }
  } catch {}
  const active=name=>{
    try {
      const r=spawnSync('/usr/bin/systemctl',['is-active','--quiet',name],{timeout:3000,stdio:'ignore'});
      return r.status===0;
    } catch {return false;}
  };
  return {
    observedAt:new Date().toISOString(),
    uptimeSeconds:Math.max(0,Math.floor(os.uptime())),
    cpuPercent,
    load1:Number(os.loadavg()[0].toFixed(2)),
    totalMemoryBytes:os.totalmem(),
    freeMemoryBytes:os.freemem(),
    diskTotalBytes,
    diskFreeBytes,
    services:{
      sshd:active('abess-ssh-ws-sshd.service'),
      gateway:active('abess-ssh-ws-gateway.service'),
      reconciler:active('abess-ssh-ws-reconciler.service')
    }
  };
}
async function awaitUsage(env,store,policyTime) {
  for(let i=0;i<25;i++){
    const usage=await readUsage(env,store,policyTime);
    if(usage)return usage;
    await delay(150);
  }
  return null;
}
export async function syncOnce(env=process.env,request=fetch,host=hostOperations(),store={state:{}}) {
  const base=httpsOrigin(env.CONTROL_API_BASE_URL);
  if(!/^[a-f0-9-]{36}$/.test(env.VPN_NODE_ID||'') || !env.VPN_NODE_KEY)
    throw Error('Node credentials missing');
  const endpoint=new URL('/api/v1/nodes/'+encodeURIComponent(env.VPN_NODE_ID)+'/ssh-ws/',base);
  const headers={Authorization:'Bearer '+env.VPN_NODE_KEY};
  const response=await request(new URL('desired',endpoint),{
    headers,redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw Error('Desired state unavailable');
  const desired=await response.json();
  const result=await reconcile(desired,store.state||{},host);
  store.state=result.state;
  store.policyAccounts=policyAccounts(desired,result);
  const generatedAt=new Date().toISOString();
  const policy={format:'abess-ssh-ws-policy-v1',generatedAt,accounts:store.policyAccounts};
  await configureSshdAccess(env,store,policy);
  await publishPolicy(env,store,policy);
  const usage=await awaitUsage(env,store,generatedAt);
  const counters=new Map(usage?.accounts?.map(x=>[x.id,x])||[]);
  const reports=result.reports.map(x=>{
    if(x.state==='error')return x;
    const entry=counters.get(x.id);
    const settings=store.policyAccounts.find(a=>a.id===x.id);
    if(!entry || !settings)return {id:x.id,state:'error'};
    return {id:x.id,state:settings.enabled && entry.usedBytes>=settings.quotaBytes
      ?'blocked':x.state,usedBytes:entry.usedBytes,online:entry.online,devices:entry.devices||[]};
  });
  const telemetry=await hostTelemetry();
  const ack=await request(new URL('status',endpoint),{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({reports,telemetry}),redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!ack.ok)throw Error('Acknowledgement rejected');
  store.lastSuccessfulAt=Date.now();
  return {...result,reports};
}
export function failClosedOffline(store,host,now=Date.now(),maxStaleMs=600000) {
  const stale=now-(store.lastSuccessfulAt||0)>maxStaleMs;
  for(const [username,user] of Object.entries(store.state||{})) {
    if(!usernamePattern.test(username)||!user.enabled)continue;
    if(stale || !Number.isFinite(Date.parse(user.expiresAt)) || Date.parse(user.expiresAt)<=now) {
      try{host.disable(username);user.enabled=false;}catch{}
    }
  }
  if(Array.isArray(store.policyAccounts)) {
    store.policyAccounts=store.policyAccounts.map(p=>({
      ...p,enabled:!stale && p.enabled && Date.parse(p.expiresAt)>now
    }));
  }
  return stale;
}
async function main() {
  if(process.getuid?.()!==0)throw Error('Linux provisioning requires root');
  if(!process.env.VPN_NODE_KEY_FILE)throw Error('VPN_NODE_KEY_FILE missing');
  if(!process.env.SSH_WS_ALLOW_USERS_FILE || !process.env.SSH_WS_POLICY_FILE || !process.env.SSH_WS_USAGE_REPORT_FILE ||
     !process.env.SSH_WS_GATEWAY_GID)throw Error('Gateway policy, usage and GID configuration required');
  const stateFile=process.env.SSH_WS_STATE_FILE||'/var/lib/abess-ssh-ws/state.json';
  const offlineLimit=Number(process.env.SSH_WS_OFFLINE_LIMIT_MS||600000);
  if(!Number.isInteger(offlineLimit)||offlineLimit<60000||offlineLimit>86400000)
    throw Error('Unsafe offline TTL');
  const store={state:{},policyAccounts:[],lastSuccessfulAt:0};
  try{
    const prev=JSON.parse(await fs.readFile(stateFile,'utf8'));
    store.state=prev.state||{};
    store.policyAccounts=prev.policyAccounts||[];
    store.lastSuccessfulAt=Number(prev.lastSuccessfulAt||0);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let running=true;
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{running=false;});
  while(running){
    const host=hostOperations();
    try{
      const key=(await fs.readFile(process.env.VPN_NODE_KEY_FILE,'utf8')).trim();
      await syncOnce({...process.env,VPN_NODE_KEY:key},fetch,host,store);
    }catch{
      failClosedOffline(store,host,Date.now(),offlineLimit);
      const policy={format:'abess-ssh-ws-policy-v1',generatedAt:new Date().toISOString(),
        accounts:store.policyAccounts||[]};
      await configureSshdAccess(process.env,store,policy);
      await publishPolicy(process.env,store,policy);
      console.error('[SSH-WS] Panel unreachable; local SSH expiry and offline policy enforced.');
    }
    await persist(stateFile,store);
    if(running)await delay(10000);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error('[SSH-WS] Reconciler startup failed');process.exitCode=1;});
}

/**
 * Privileged host reconciler for ABESS-owned OpenSSH accounts.
 * NEVER executes arbitrary commands received from the panel.
 * Node 22+, Debian/Ubuntu host; group "abessvpn" must be provisioned first.
 */
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const usernamePattern=/^abv_[a-f0-9]{12}$/;
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
       (a.enabled && (typeof a.password!=='string' || !/^[A-Za-z0-9_-]{32,96}$/.test(a.password))))
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
  for(const a of accounts) {
    const old=previous[a.username];
    try {
      if(old && old.id!==a.id)throw Error('Account id changed unexpectedly');
      if(!old && host.exists(a.username))throw Error('Existing unmanaged Linux user');
      const enabled=a.enabled && Date.parse(a.expiresAt)>Date.now();
      if(enabled) {
        const missing=!host.exists(a.username);
        if(missing)host.create(a.username);
        // Record ownership immediately in case chpasswd or account activation fails.
        state[a.username]={id:a.id,passwordHash:old?.passwordHash||null,enabled:false,expiresAt:a.expiresAt};
        const hash=crypto.createHash('sha256').update(a.password).digest('hex');
        // A manually deleted user must receive its password again even if it
        // was already present in the previous local state snapshot.
        if(missing || old?.passwordHash!==hash)host.password(a.username,a.password);
        if(missing || !old?.enabled || old.passwordHash!==hash)host.enable(a.username);
        state[a.username]={id:a.id,passwordHash:hash,enabled:true,expiresAt:a.expiresAt};
      } else {
        if(!old || old.enabled)host.disable(a.username);
        state[a.username]={id:a.id,passwordHash:old?.passwordHash||null,enabled:false,expiresAt:a.expiresAt};
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
  const result=await reconcile(await response.json(),store.state||{},host);
  store.state=result.state;
  const ack=await request(new URL('status',endpoint),{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({reports:result.reports}),redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!ack.ok)throw Error('Acknowledgement rejected');
  store.lastSuccessfulAt=Date.now();
  return result;
}
export function failClosedOffline(store,host,now=Date.now(),maxStaleMs=600000) {
  const stale=now-(store.lastSuccessfulAt||0)>maxStaleMs;
  for(const [username,user] of Object.entries(store.state||{})) {
    if(!usernamePattern.test(username)||!user.enabled)continue;
    if(stale || !Number.isFinite(Date.parse(user.expiresAt)) || Date.parse(user.expiresAt)<=now) {
      try{host.disable(username);user.enabled=false;}catch{}
    }
  }
  return stale;
}
async function persist(file,store) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.'+process.pid+'.tmp';
  await fs.writeFile(temp,JSON.stringify(store),{mode:0o600,flag:'wx'});
  await fs.rename(temp,file);
}
async function main() {
  if(process.getuid?.()!==0)throw Error('Linux provisioning requires root');
  if(!process.env.VPN_NODE_KEY_FILE)throw Error('VPN_NODE_KEY_FILE missing');
  const stateFile=process.env.SSH_WS_STATE_FILE||'/var/lib/abess-ssh-ws/state.json';
  const offlineLimit=Number(process.env.SSH_WS_OFFLINE_LIMIT_MS||600000);
  if(!Number.isInteger(offlineLimit)||offlineLimit<60000||offlineLimit>86400000)
    throw Error('Unsafe offline TTL');
  const store={state:{},lastSuccessfulAt:0};
  try {
    const prev=JSON.parse(await fs.readFile(stateFile,'utf8'));
    store.state=prev.state||{};store.lastSuccessfulAt=Number(prev.lastSuccessfulAt||0);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let running=true;
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{running=false;});
  while(running) {
    const host=hostOperations();
    try {
      const key=(await fs.readFile(process.env.VPN_NODE_KEY_FILE,'utf8')).trim();
      await syncOnce({...process.env,VPN_NODE_KEY:key},fetch,host,store);
    }catch{
      failClosedOffline(store,host,Date.now(),offlineLimit);
      console.error('[SSH-WS] Control unavailable; local expiry/offline policy applied.');
    }
    await persist(stateFile,store);
    if(running)await delay(10000);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error('[SSH-WS] Reconciler startup failed');process.exitCode=1;});
}

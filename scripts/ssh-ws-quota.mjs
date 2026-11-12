/**
 * Persistent SSH-WS per-licence byte accounting and stream admission.
 *
 * A client must know an unguessable 256-bit WebSocket path secret. It is not
 * sufficient to present a public/common /ssh-ws path.
 *
 * Reservations are fsynced BEFORE bytes cross the gateway, in 256 KiB
 * increments. After an unclean crash unused reserved bytes may be charged,
 * but a crash cannot reset a spent quota. Exactly one gateway process must
 * own this ledger file. Never make multiple instances share it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ID=/^ssh_[0-9a-f-]{36}$/;
const HEX=/^[0-9a-f]{64}$/;
const USER=/^abv_[0-9a-f]{12}$/;
const MAX_SAFE=Number.MAX_SAFE_INTEGER;
const MAX_ACCOUNTS=2000;

function integer(n, min, max=MAX_SAFE) {
  return Number.isSafeInteger(n) && n>=min && n<=max;
}
export function validatePolicy(value, now=Date.now()) {
  if(!value || value.format!=='abess-ssh-ws-policy-v1' ||
     !Array.isArray(value.accounts) || value.accounts.length>MAX_ACCOUNTS ||
     !Number.isFinite(Date.parse(value.generatedAt)) ||
     Date.parse(value.generatedAt)>now+5000) throw Error('Invalid gateway policy');
  const ids=new Set(),tokens=new Set(),out=[];
  for(const a of value.accounts) {
    if(!a || !ID.test(a.id) || !USER.test(a.username) ||
       !HEX.test(a.tokenHash) || typeof a.enabled!=='boolean' ||
       !integer(a.quotaBytes,1) || !integer(a.baselineUsedBytes,0) ||
       !integer(a.maxConnections,1,10) ||
       !Number.isFinite(Date.parse(a.expiresAt)) ||
       ids.has(a.id) || tokens.has(a.tokenHash)) throw Error('Invalid gateway licence');
    ids.add(a.id);tokens.add(a.tokenHash);
    out.push({...a});
  }
  return {generatedAt:Date.parse(value.generatedAt),accounts:out};
}
function syncAtomic(file, object) {
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const temp=file+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex');
  const fd=fs.openSync(temp,'wx',0o600);
  try {
    fs.writeFileSync(fd,JSON.stringify(object));
    fs.fsyncSync(fd);
  } finally {fs.closeSync(fd);}
  try {
    fs.renameSync(temp,file);
    const dh=fs.openSync(dir,'r');
    try{fs.fsyncSync(dh);}finally{fs.closeSync(dh);}
  } catch(e) {try{fs.unlinkSync(temp);}catch{}throw e;}
}
export class QuotaLedger {
  constructor({usageFile,reportFile,reservationBytes=262144}) {
    if(!usageFile || !reportFile || !integer(reservationBytes,4096,1048576))
      throw Error('Invalid gateway ledger configuration');
    this.usageFile=usageFile;
    // Isolate durable reservations by account. Each 256KiB reservation writes
    // only ~100 bytes instead of rewriting a potentially huge multi-user JSON.
    this.accountDir=usageFile+'.accounts';
    this.reportFile=reportFile;
    this.reservationBytes=reservationBytes;
    this.balances={}; // accountId -> {usedBytes, creditBytes, sessions}
    this.policy=null;
    this.lastGoodPolicyAt=0;
    this._load();
  }
  _load() {
    let persisted;
    try{persisted=JSON.parse(fs.readFileSync(this.usageFile,'utf8'));}
    catch(e){if(e.code!=='ENOENT')throw Error('Usage ledger unreadable: refusing to open gateway');}
    if(persisted){
      if(persisted.format!=='abess-ssh-ws-ledger-v1' || !persisted.balances ||
         typeof persisted.balances!=='object' || Array.isArray(persisted.balances))
        throw Error('Corrupt usage ledger');
      for(const [id,v] of Object.entries(persisted.balances)) {
        if(!ID.test(id) || !integer(v,0))throw Error('Corrupt usage counter');
        this.balances[id]={usedBytes:v,creditBytes:0,sessions:0};
      }
    }
    if(!fs.existsSync(this.accountDir))return;
    for(const name of fs.readdirSync(this.accountDir)) {
      if(!/^ssh_[0-9a-f-]{36}\.json$/.test(name))throw Error('Unexpected quota data');
      const record=JSON.parse(fs.readFileSync(path.join(this.accountDir,name),'utf8'));
      if(record?.format!=='abess-ssh-ws-account-v1' ||
         record.id+'.json'!==name || !integer(record.usedBytes,0))
        throw Error('Invalid account usage record');
      // Individual records are updated on every reservation/refund and are
      // therefore authoritative over the compatibility summary snapshot.
      this.balances[record.id]={usedBytes:record.usedBytes,creditBytes:0,sessions:0};
    }
  }
  _persistOne(id) {
    if(!ID.test(id))throw Error('Unsafe ledger identifier');
    const v=this.balances[id];
    if(!v || !integer(v.usedBytes+v.creditBytes,0))throw Error('Unsafe quota counter');
    syncAtomic(path.join(this.accountDir,id+'.json'),{
      format:'abess-ssh-ws-account-v1',id,usedBytes:v.usedBytes+v.creditBytes
    });
  }
  _persist() {
    // Compact human-readable summary on graceful close; hot-path writes touch
    // only one account's journal file, not the full account collection.
    const balances={};
    for(const [id,v] of Object.entries(this.balances))balances[id]=v.usedBytes+v.creditBytes;
    syncAtomic(this.usageFile,{format:'abess-ssh-ws-ledger-v1',balances});
  }
  setPolicy(policy,now=Date.now()) {
    const parsed=validatePolicy(policy,now);
    // If a record already exists, the panel must NEVER reset local usage.
    for(const a of parsed.accounts) {
      const v=this.balances[a.id];
      if(!v){
        this.balances[a.id]={usedBytes:a.baselineUsedBytes,creditBytes:0,sessions:0};
        this._persistOne(a.id);
      } else if(a.baselineUsedBytes>v.usedBytes+v.creditBytes) {
        v.usedBytes=a.baselineUsedBytes;
        v.creditBytes=0;
        this._persistOne(a.id);
      }
    }
    this.policy=parsed;
    this.lastGoodPolicyAt=now;
    return parsed;
  }
  _profile(id,now=Date.now(),maxAgeMs=60000) {
    if(!this.policy || now-this.policy.generatedAt>maxAgeMs ||
       now-this.policy.generatedAt < -5000)return null;
    const p=this.policy.accounts.find(a=>a.id===id);
    const v=this.balances[id];
    if(!p || !v || !p.enabled || Date.parse(p.expiresAt)<=now ||
       v.usedBytes>=p.quotaBytes)return null;
    return p;
  }
  authorized(id,now=Date.now()) {
    return !!this._profile(id,now);
  }
  findBySecret(secret,now=Date.now()) {
    if(typeof secret!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))return null;
    const needle=crypto.createHash('sha256').update(secret).digest('hex');
    const p=this.policy?.accounts.find(a=>a.tokenHash===needle);
    return p && this.authorized(p.id,now) ? p.id : null;
  }
  start(id,now=Date.now()) {
    const p=this._profile(id,now),b=this.balances[id];
    if(!p || b.sessions>=p.maxConnections)return false;
    b.sessions++;
    return true;
  }
  stop(id) {
    const b=this.balances[id];
    if(!b)return;
    b.sessions=Math.max(0,b.sessions-1);
    if(b.sessions===0 && b.creditBytes>0) {
      // Refund unused reservations after clean connection closure.
      b.creditBytes=0;
      this._persistOne(id);
    }
    this.report();
  }
  consume(id,requested,now=Date.now()) {
    const p=this._profile(id,now),b=this.balances[id];
    if(!p || !integer(requested,0,65536))return 0;
    let allowance=Math.min(requested,Math.max(0,p.quotaBytes-b.usedBytes));
    while(allowance>b.creditBytes) {
      const remaining=p.quotaBytes-b.usedBytes-b.creditBytes;
      if(remaining<=0)break;
      const extra=Math.min(Math.max(this.reservationBytes,allowance-b.creditBytes),remaining);
      if(!integer(extra,1))throw Error('Unsafe byte reservation');
      b.creditBytes+=extra;
      try{this._persistOne(id);}catch(e){b.creditBytes-=extra;throw e;}
    }
    const count=Math.min(allowance,b.creditBytes);
    b.usedBytes+=count;
    b.creditBytes-=count;
    return count;
  }
  report() {
    const accounts=Object.entries(this.balances).map(([id,v])=>({
      id,usedBytes:v.usedBytes,online:v.sessions
    }));
    syncAtomic(this.reportFile,{format:'abess-ssh-ws-usage-v1',observedAt:new Date().toISOString(),
      policyObservedAt:this.policy?new Date(this.policy.generatedAt).toISOString():null,accounts});
  }
  close(){this._persist();this.report();}
  online(id){return this.balances[id]?.sessions||0;}
  used(id){return this.balances[id]?.usedBytes||0;}
}

/** Read-only production HTTP checks. Temporary sessions expire in five minutes
 * and are removed in finally; no payment, licence or external message is sent. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {DocumentStore} from '../modules/store.ts';
import {SecurityService} from '../modules/security.ts';
const directory=process.env.DATA_DIR||'/app/data';
if(!process.env.DATABASE_URL||!process.env.MASTER_SECRET)throw Error('Production PostgreSQL credentials required');
const store=new DocumentStore(directory,process.env.DATABASE_URL);
const file=name=>path.join(directory,name+'.json');
const security=new SecurityService(()=>store.exists(file('security'))?store.read(file('security')):{mfa:{},sessions:{}},v=>store.write(file('security'),v),()=>process.env.MASTER_SECRET);
const tokens=[];let actors=[];
try{
  actors=await store.transaction(()=>{
    const users=store.read(file('users')),map=new Map(users.map(u=>[u.id,u]));
    const active=u=>{const seen=new Set();while(u){if(u.status!=='active'||seen.has(u.id))return false;seen.add(u.id);if(!u.parentId)return true;u=map.get(u.parentId)}return false};
    const admin=users.find(u=>u.role==='SUPER_ADMIN'&&active(u));assert(admin,'No active administrator');
    if(process.env.REQUIRE_ADMIN_MFA==='true')assert(security.enabled(admin.id),'Administrator must configure MFA before management verification');
    const reseller=users.find(u=>u.role==='RESELLER'&&active(u));
    return [admin,...(reseller?[reseller]:[])].map(user=>{
      const token='sess_'+crypto.randomBytes(32).toString('hex');tokens.push(token);
      security.sessions.set(token,{userId:user.id,role:user.role,email:user.email,createdAt:Date.now()-24*3600000+5*60000,agent:'ABESS deployment feature verification'});
      return {role:user.role,token};
    });
  });
  async function call(route,actor,status=200){
    const r=await fetch('http://127.0.0.1:3000'+route,{headers:actor?{Authorization:'Bearer '+actor.token}:{},signal:AbortSignal.timeout(8000)});
    assert.equal(r.status,status,'Unexpected HTTP status for '+route);return r.headers.get('content-type')?.includes('application/json')?r.json():r.text();
  }
  const admin=actors[0];
  for(const route of ['/api/v1/admin/announcements','/api/v1/admin/usage-history?days=7','/api/v1/admin/network-health','/api/v1/admin/fleet','/api/v1/support/tickets','/api/v1/notifications'])await call(route,admin);
  const publicNotices=await call('/api/v1/announcements/active');assert(publicNotices.announcements.every(a=>!a.audience||a.audience==='PUBLIC'));
  await call('/api/v1/portal/me',null,401);await call('/client');
  if(actors[1]){const reseller=actors[1];for(const route of ['/api/v1/announcements/feed','/api/v1/admin/usage-history?days=7','/api/v1/support/tickets','/api/v1/notifications'])await call(route,reseller);await call('/api/v1/admin/fleet',reseller,403);await call('/api/v1/admin/announcements',reseller,403)}
  let fleet;
  for(let attempt=0;attempt<8;attempt++){
    fleet=await call('/api/v1/admin/fleet',admin);
    if(fleet.nodes.some(n=>n.online&&n.hostTelemetry?.sessionGuard?.healthy&&n.hostTelemetry.sessionGuard.strictBytes))break;
    await new Promise(r=>setTimeout(r,5000));
  }
  assert(fleet.nodes.some(n=>n.online&&n.hostTelemetry?.sessionGuard?.healthy&&n.hostTelemetry.sessionGuard.strictBytes),'No fresh healthy strict quota controller reported by a managed server');
  console.log('PANEL_FEATURES_VERIFIED='+JSON.stringify({announcementAudienceIsolation:true,usageHistory:true,support:true,customerPortalAccessControl:true,fleet:true,rolesTested:actors.map(a=>a.role),sessionControllerHealthy:true,payments:'manual',email:'requires-provider'}));
}finally{
  try{await store.transaction(()=>{for(const token of tokens)security.sessions.delete(token)})}finally{await store.pool.end()}
}

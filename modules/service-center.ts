import crypto from 'node:crypto';
import type {Express,RequestHandler} from 'express';
import type {SshAccount,SshState} from './ssh.js';
import {safeSshAccount,exportSshAccount} from './ssh.js';
import {unseal} from './security.js';
import type {VpnNode} from './operations.js';
import {createTelegramClaim,type DeliveryJob,type TelegramLink,type TelegramClaim} from './notification-delivery.js';
import {visibleNotice,publicNotice,receiptKey,type Notice,type NoticeReceipts} from './announcements.js';

type Actor={id:string;name:string;role:string;email?:string;status?:string};
type Sample={bytes:number;samples:number};
export type UsageHistory={counters:Record<string,{bytes:number;observedAt:string;baselineAt:string}>;days:Record<string,Record<string,Sample>>;nodes:Record<string,Record<string,any>>};
export const emptyUsage=():UsageHistory=>({counters:{},days:{},nodes:{}});
export function recordUsage(history:UsageHistory,account:SshAccount,now=new Date().toISOString()){
  const bytes=account.usedBytes;if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isFinite(Date.parse(now)))return;
  const old=history.counters[account.id];
  if(old&&(Date.parse(now)<Date.parse(old.observedAt)||bytes<old.bytes))return;
  // First observation establishes a baseline; do not invent historical usage.
  const delta=old?Math.max(0,bytes-old.bytes):0;
  history.counters[account.id]={bytes:Math.max(bytes,old?.bytes||0),observedAt:now,baselineAt:old?.baselineAt||now};
  const day=now.slice(0,10),bucket=history.days[day]||{},row=bucket[account.id]||{bytes:0,samples:0};
  if(delta>0||!old){row.bytes+=delta;row.samples++;bucket[account.id]=row;history.days[day]=bucket;}
  const cutoff=new Date(Date.parse(now)-90*86400000).toISOString().slice(0,10);
  for(const key of Object.keys(history.days))if(key<cutoff)delete history.days[key];
}
export type Ticket={id:string;subject:string;category:string;priority:string;status:'OPEN'|'WAITING'|'RESOLVED'|'CLOSED';createdBy:string;createdName:string;accountId?:string;assignedTo?:string;createdAt:string;updatedAt:string;messages:{id:string;authorId:string;authorName:string;message:string;at:string}[]};
export type Notification={id:string;userId:string;key:string;title:string;message:string;at:string;readAt?:string;kind:string;accountId?:string};
export type ServiceState={deliveryJobs?:DeliveryJob[];telegramLinks?:Record<string,TelegramLink>;telegramClaims?:Record<string,TelegramClaim>;tickets:Ticket[];notifications:Notification[];preferences:Record<string,{inApp:boolean;telegram:boolean;email:boolean;expiryHours:number;quotaPercent:number}>;fleet:Record<string,{capacity:number;acceptNew:boolean;enforcementMode:'audit'|'enforce-new'|'enforce-all';enforcementSince?:string}>;migrations:Record<string,{accountId:string;sourceId:string;targetId:string;expires:number;actor:string;fingerprint:string}>;deliveries?:Record<string,{status:string;attempts:number;lastError?:string;at?:string}>};
export const emptyService=():ServiceState=>({tickets:[],notifications:[],preferences:{},fleet:{},migrations:{},deliveries:{}});
const record=(v:any)=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const date=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validServiceState(v:any):v is ServiceState{
  if(!record(v)||!Array.isArray(v.tickets)||v.tickets.length>20000||!Array.isArray(v.notifications)||v.notifications.length>20000||!record(v.preferences)||!record(v.fleet)||!record(v.migrations))return false;
  if(v.tickets.some((t:any)=>!record(t)||typeof t.id!=='string'||typeof t.subject!=='string'||typeof t.createdBy!=='string'||!['OPEN','WAITING','RESOLVED','CLOSED'].includes(t.status)||!date(t.createdAt)||!date(t.updatedAt)||!Array.isArray(t.messages)||t.messages.length>500||t.messages.some((m:any)=>!record(m)||typeof m.id!=='string'||typeof m.authorId!=='string'||typeof m.message!=='string'||m.message.length>4000||!date(m.at))))return false;
  if(v.notifications.some((n:any)=>!record(n)||typeof n.id!=='string'||typeof n.userId!=='string'||typeof n.key!=='string'||typeof n.title!=='string'||typeof n.message!=='string'||!date(n.at)))return false;
  if(Object.values(v.preferences).some((p:any)=>!record(p)||['inApp','telegram','email'].some(k=>typeof p[k]!=='boolean')||!Number.isInteger(p.expiryHours)||p.expiryHours<1||p.expiryHours>168||!Number.isInteger(p.quotaPercent)||p.quotaPercent<50||p.quotaPercent>100))return false;
  if(Object.values(v.fleet).some((n:any)=>!record(n)||!Number.isInteger(n.capacity)||n.capacity<1||n.capacity>2000||typeof n.acceptNew!=='boolean'||!['audit','enforce-new','enforce-all'].includes(n.enforcementMode)))return false;
  if(v.telegramLinks!==undefined&&(!record(v.telegramLinks)||Object.values(v.telegramLinks).some((l:any)=>!record(l)||!/^\d{1,18}$/.test(l.chatId)||!date(l.verifiedAt))))return false;
  if(v.deliveryJobs!==undefined&&(!Array.isArray(v.deliveryJobs)||v.deliveryJobs.length>10000||v.deliveryJobs.some((j:any)=>!record(j)||typeof j.userId!=='string'||!['PENDING','SENDING','DELIVERED','FAILED'].includes(j.status)||!['telegram','email'].includes(j.channel)||!Number.isInteger(j.attempts)||!Number.isFinite(j.nextAttempt)||!date(j.createdAt)||!date(j.updatedAt))))return false;
  return true;
}
export function validUsageHistory(v:any):v is UsageHistory{
  if(!record(v)||!record(v.counters)||!record(v.days)||!record(v.nodes))return false;
  if(Object.values(v.counters).some((c:any)=>!record(c)||!Number.isSafeInteger(c.bytes)||c.bytes<0||!date(c.observedAt)||!date(c.baselineAt)))return false;
  if(Object.entries(v.days).some(([day,rows])=>!/^\d{4}-\d{2}-\d{2}$/.test(day)||!record(rows)||Object.values(rows as any).some((r:any)=>!record(r)||!Number.isSafeInteger(r.bytes)||r.bytes<0||!Number.isInteger(r.samples)||r.samples<0)))return false;
  if(Object.entries(v.nodes).some(([at,nodes])=>!date(at)||!record(nodes)||Object.values(nodes as any).some((n:any)=>!record(n)||!date(n.observedAt)||!Number.isFinite(n.cpuPercent))))return false;
  return true;
}
export type PortalSessions=Record<string,{accountId:string;passwordHash:string;expires:number}>;
const sha=(v:string)=>crypto.createHash('sha256').update(v).digest('hex');
const text=(v:unknown,max:number,name:string)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw Error(name+' invalide.');return v.trim()};
const isAdmin=(actor:Actor)=>['ADMIN','SUPER_ADMIN'].includes(actor.role);
export const nodeOnline=(node:VpnNode)=>Boolean(node.enabled&&node.sshWsManaged&&Date.now()-Date.parse(node.sshWsAgentSeenAt||'')<60000&&Date.now()-Date.parse(node.sshWsAgentSeenAt||'')>=-5000);
export function fleetRows(nodes:VpnNode[],accounts:SshAccount[],state:ServiceState){return nodes.filter(n=>n.sshWsManaged).map(n=>{
  const config=state.fleet[n.id]||{capacity:500,acceptNew:true,enforcementMode:'enforce-all'};
  const mine=accounts.filter(a=>a.nodeId===n.id&&a.managed);
  return {id:n.id,name:n.name,host:n.host,online:nodeOnline(n),...config,enforcementMode:'enforce-all',clients:mine.length,available:Math.max(0,config.capacity-mine.length),sessions:mine.reduce((v,a)=>v+(a.online||0),0),usedBytes:mine.reduce((v,a)=>v+a.usedBytes,0),hostTelemetry:n.sshWsHost||null};
})}
export function chooseNode(nodes:VpnNode[],accounts:SshAccount[],state:ServiceState){return fleetRows(nodes,accounts,state).filter(n=>n.online&&n.acceptNew&&n.available>0).sort((a,b)=>a.clients/a.capacity-b.clients/b.capacity||a.sessions-b.sessions)[0]?.id}
export function registerServiceCenter(app:Express,d:{authenticate:RequestHandler;limiter:RequestHandler;read:()=>ServiceState;write:(s:ServiceState)=>void;usage:()=>UsageHistory;saveUsage:(s:UsageHistory)=>void;ssh:()=>SshState;saveSsh:(s:SshState)=>void;nodes:()=>VpnNode[];users:()=>Actor[];canManage:(a:Actor,ownerId:string)=>boolean;ownerActive:(id?:string)=>boolean;key:string;audit:(e:any)=>void;sessions:()=>PortalSessions;saveSessions:(v:PortalSessions)=>void;announcements:()=>Notice[];receipts:()=>NoticeReceipts;saveReceipts:(v:NoticeReceipts)=>void;guard:(ip:string)=>boolean;failure:(ip:string)=>void;queueTest:(actor:Actor,channel:'telegram'|'email')=>string;botUsername:()=>string|undefined;deliveryStatus:(actor:Actor)=>{telegram:boolean;email:boolean;telegramBotAvailable?:boolean};afterCommit:(fn:()=>void)=>void}){
  const allowed=(actor:Actor,a:SshAccount)=>isAdmin(actor)||Boolean(a.resellerId&&d.canManage(actor,a.resellerId));
  const audit=(req:any,action:string,details:string)=>d.audit({actor:req.user.id,role:req.user.role,action,details});
  const admin:RequestHandler=(req,res,next)=>(req as any).user.role==='SUPER_ADMIN'?next():void res.sendStatus(403);
  const preferences=(s:ServiceState,id:string)=>s.preferences[id]||{inApp:true,telegram:false,email:false,expiryHours:24,quotaPercent:80};
  function history(accounts:SshAccount[],days:number){
    const h=d.usage(),ids=new Set(accounts.map(a=>a.id)),cutoff=new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10);
    const rows=Object.keys(h.days).filter(day=>day>=cutoff).sort().map(day=>({day,bytes:Object.entries(h.days[day]).filter(([id])=>ids.has(id)).reduce((n,[,r])=>n+r.bytes,0)}));
    return {days:rows,accounts:accounts.map(a=>({id:a.id,label:a.label,baselineAt:h.counters[a.id]?.baselineAt||null,lastObservedAt:a.usageObservedAt||null,bytes:h.counters[a.id]?.bytes??null,days:Object.keys(h.days).filter(day=>day>=cutoff&&h.days[day][a.id]).sort().map(day=>({day,...h.days[day][a.id]}))})),retentionDays:90,collectedSince:Object.values(h.counters).map(c=>c.baselineAt).sort()[0]||null};
  }
  app.get('/api/v1/admin/usage-history',d.authenticate,(req,res)=>{
    const days=Number(req.query.days||30);if(!Number.isInteger(days)||days<1||days>90)return res.sendStatus(400);
    let accounts=d.ssh().accounts.filter(a=>allowed((req as any).user,a));
    if(req.query.accountId)accounts=accounts.filter(a=>a.id===String(req.query.accountId));
    res.set('Cache-Control','no-store').json(history(accounts,days));
  });
  app.get('/api/v1/admin/network-health',d.authenticate,admin,(_req,res)=>{
    const h=d.usage();res.json({nodes:fleetRows(d.nodes(),d.ssh().accounts,d.read()),history:h.nodes,measuredAt:new Date().toISOString()});
  });
  const ticketAllowed=(actor:Actor,t:Ticket)=>isAdmin(actor)||t.createdBy===actor.id||Boolean(t.accountId&&d.ssh().accounts.some(a=>a.id===t.accountId&&allowed(actor,a)));
  function createTicket(actor:Actor,body:any,accountId?:string){
    const subject=text(body.subject,160,'Objet'),message=text(body.message,4000,'Message');
    if(body.category!==undefined&&!['TECHNICAL','BILLING','RENEWAL','OTHER'].includes(body.category))throw Error('Catégorie invalide.');
    if(body.priority!==undefined&&!['NORMAL','HIGH'].includes(body.priority))throw Error('Priorité invalide.');
    const s=d.read();if(s.tickets.filter(t=>t.createdBy===actor.id&&['OPEN','WAITING'].includes(t.status)).length>=20)throw Error('20 tickets ouverts au maximum.');
    if(s.tickets.length>=20000)throw Error('Capacité du support atteinte.');
    const now=new Date().toISOString(),ticket:Ticket={id:'tkt_'+crypto.randomUUID(),subject,category:body.category||'TECHNICAL',priority:body.priority||'NORMAL',status:'OPEN',createdBy:actor.id,createdName:actor.name,accountId,createdAt:now,updatedAt:now,messages:[{id:crypto.randomUUID(),authorId:actor.id,authorName:actor.name,message,at:now}]};
    s.tickets.unshift(ticket);d.write(s);d.audit({actor:actor.id,role:actor.role,action:'TICKET_CREATED',details:ticket.id});return ticket;
  }
  app.get('/api/v1/support/tickets',d.authenticate,(req,res)=>res.json({tickets:d.read().tickets.filter(t=>ticketAllowed((req as any).user,t)).map(t=>({...t,messages:undefined,messageCount:t.messages.length})),operators:d.users().filter(u=>isAdmin(u)&&u.status==='active').map(u=>({id:u.id,name:u.name}))}));
  app.post('/api/v1/support/tickets',d.authenticate,(req,res)=>{
    try{const id=req.body?.accountId;
      if(id!==undefined&&id!==''&&!d.ssh().accounts.some(a=>a.id===id&&allowed((req as any).user,a)))return res.sendStatus(404);
      res.status(201).json(createTicket((req as any).user,req.body,id||undefined));
    }catch(e){res.status(400).json({error:(e as Error).message})}
  });
  app.get('/api/v1/support/tickets/:id',d.authenticate,(req,res)=>{const t=d.read().tickets.find(t=>t.id===req.params.id&&ticketAllowed((req as any).user,t));return t?res.json(t):res.sendStatus(404)});
  function reply(actor:Actor,id:string,body:any,permit:(t:Ticket)=>boolean){
    const s=d.read(),t=s.tickets.find(t=>t.id===id&&permit(t));if(!t)return null;
    if(t.status==='CLOSED')throw Error('Rouvrez le ticket avant de répondre.');
    if(t.messages.length>=500)throw Error('Limite de messages atteinte.');
    const message=text(body.message,4000,'Message'),now=new Date().toISOString();
    t.messages.push({id:crypto.randomUUID(),authorId:actor.id,authorName:actor.name,message,at:now});t.updatedAt=now;t.status=isAdmin(actor)?'WAITING':'OPEN';d.write(s);
    d.audit({actor:actor.id,role:actor.role,action:'TICKET_REPLIED',details:t.id});return t;
  }
  app.post('/api/v1/support/tickets/:id/messages',d.authenticate,(req,res)=>{try{const t=reply((req as any).user,String(req.params.id),req.body,t=>ticketAllowed((req as any).user,t));return t?res.json(t):res.sendStatus(404)}catch(e){res.status(400).json({error:(e as Error).message})}});
  app.patch('/api/v1/support/tickets/:id',d.authenticate,(req,res)=>{
    const actor=(req as any).user,s=d.read(),t=s.tickets.find(t=>t.id===req.params.id&&ticketAllowed(actor,t));if(!t)return res.sendStatus(404);
    const status=req.body?.status;if(status!==undefined&&!['OPEN','WAITING','RESOLVED','CLOSED'].includes(status))return res.sendStatus(400);
    if(req.body?.assignedTo!==undefined){if(!isAdmin(actor))return res.sendStatus(403);const id=req.body.assignedTo;if(id!==''&&!d.users().some(u=>u.id===id&&isAdmin(u)&&u.status==='active'))return res.sendStatus(400);t.assignedTo=id||undefined;}
    if(status)t.status=status;t.updatedAt=new Date().toISOString();d.write(s);audit(req,'TICKET_UPDATED',t.id);res.json(t);
  });
  function buildAlerts(actor:Actor){
    const s=d.read(),p=preferences(s,actor.id),now=Date.now();let changed=false;
    const add=(key:string,title:string,message:string,kind:string,accountId?:string)=>{if(!s.notifications.some(n=>n.userId===actor.id&&n.key===key)){s.notifications.push({id:'ntf_'+crypto.randomUUID(),userId:actor.id,key,title,message,kind,accountId,at:new Date().toISOString()});changed=true}};
    for(const notice of d.announcements().filter(a=>visibleNotice(a,actor))){add('announcement:'+notice.id+':'+(notice.revision||1),notice.title,notice.message,'ANNOUNCEMENT')}
    for(const a of d.ssh().accounts.filter(a=>allowed(actor,a))){
      const hours=(Date.parse(a.expiresAt)-now)/3600000;
      if(hours>=0&&hours<=p.expiryHours)add('expiry:'+a.id+':'+a.expiresAt,a.label+' expire bientôt','Expiration : '+a.expiresAt,'EXPIRY',a.id);
      if(a.usageObservedAt&&a.quotaBytes>0&&a.usedBytes/a.quotaBytes*100>=p.quotaPercent)add('quota:'+a.id+':'+a.quotaBytes,a.label+' : quota presque épuisé','Consommation : '+Math.round(a.usedBytes/a.quotaBytes*100)+' %.','QUOTA',a.id);
      if(a.online!==undefined&&a.online>a.maxConnections)add('sessions:'+a.id+':'+new Date().toISOString().slice(0,10),a.label+' : limite de sessions dépassée',a.online+' sessions observées pour une limite de '+a.maxConnections+'.','SESSIONS',a.id);
    }
    if(actor.role==='SUPER_ADMIN')for(const n of d.nodes())if(n.enabled&&!nodeOnline(n))add('node:'+n.id+':'+new Date().toISOString().slice(0,10),n.name+' hors ligne','Aucune remontée récente de l’agent.','NODE');
    if(changed){s.notifications=s.notifications.slice(-20000);d.write(s)}
    return {s,p};
  }
  app.get('/api/v1/notifications',d.authenticate,(req,res)=>{
    const actor=(req as any).user,{s,p}=buildAlerts(actor);
    res.json({notifications:p.inApp?s.notifications.filter(n=>n.userId===actor.id).slice(-200).reverse():[],preferences:p,channels:d.deliveryStatus(actor)});
  });
  app.post('/api/v1/notifications/:id/read',d.authenticate,(req,res)=>{const s=d.read(),row=s.notifications.find(n=>n.id===req.params.id&&n.userId===(req as any).user.id);if(!row)return res.sendStatus(404);row.readAt||=new Date().toISOString();d.write(s);res.json({ok:true})});
  app.put('/api/v1/notifications/preferences',d.authenticate,(req,res)=>{
    const b=req.body;if(!b||['inApp','telegram','email'].some(k=>typeof b[k]!=='boolean')||!Number.isInteger(b.expiryHours)||b.expiryHours<1||b.expiryHours>168||!Number.isInteger(b.quotaPercent)||b.quotaPercent<50||b.quotaPercent>100)return res.sendStatus(400);
    const channels=d.deliveryStatus((req as any).user);if((b.email&&!channels.email)||(b.telegram&&!channels.telegram))return res.status(409).json({error:'Ce canal externe n’est pas configuré.'});
    const s=d.read();s.preferences[(req as any).user.id]={inApp:b.inApp,email:b.email,telegram:b.telegram,expiryHours:b.expiryHours,quotaPercent:b.quotaPercent};d.write(s);audit(req,'NOTIFICATION_PREFERENCES_UPDATED','');res.json({ok:true});
  });
  app.post('/api/v1/notifications/test',d.authenticate,(req,res)=>{
    const actor=(req as any).user,channel=req.body?.channel;
    if(!['telegram','email'].includes(channel))return res.sendStatus(400);
    if(!d.deliveryStatus(actor)[channel as 'telegram'|'email'])return res.status(503).json({error:'Canal non configuré ou compte Telegram non associé.'});
    const id=d.queueTest(actor,channel);res.status(202).json({ok:true,id,status:'PENDING'});
  });
  app.get('/api/v1/notifications/deliveries',d.authenticate,(req,res)=>res.json({deliveries:(d.read().deliveryJobs||[]).filter(j=>j.userId===(req as any).user.id).slice(-100).reverse().map(({message,title,...j})=>j)}));
  app.post('/api/v1/notifications/telegram/link',d.authenticate,(req,res)=>{
    const actor=(req as any).user;if(!d.deliveryStatus(actor).telegramBotAvailable||!d.botUsername())return res.status(503).json({error:'Le bot Telegram n’est pas encore configuré ou vérifié.'});
    const s=d.read(),token=createTelegramClaim(s,actor.id);d.write(s);res.json({url:'https://t.me/'+d.botUsername()+'?start=notify_'+token,expiresInSeconds:600});
  });
  app.delete('/api/v1/notifications/telegram/link',d.authenticate,(req,res)=>{const s=d.read(),id=(req as any).user.id;delete s.telegramLinks?.[id];if(s.preferences[id])s.preferences[id].telegram=false;d.write(s);res.json({ok:true})});
  app.get('/api/v1/admin/fleet',d.authenticate,admin,(_req,res)=>{const s=d.read();res.json({nodes:fleetRows(d.nodes(),d.ssh().accounts,s),recommendedNodeId:chooseNode(d.nodes(),d.ssh().accounts,s)})});
  app.put('/api/v1/admin/fleet/:id',d.authenticate,admin,(req,res)=>{
    if(!d.nodes().some(n=>n.id===req.params.id))return res.sendStatus(404);const b=req.body;
    if(!Number.isInteger(b.capacity)||b.capacity<1||b.capacity>2000||typeof b.acceptNew!=='boolean'||!['audit','enforce-new','enforce-all'].includes(b.enforcementMode))return res.sendStatus(400);
    const s=d.read(),previous=s.fleet[String(req.params.id)];s.fleet[String(req.params.id)]={capacity:b.capacity,acceptNew:b.acceptNew,enforcementMode:'enforce-all',enforcementSince:previous?.enforcementMode===b.enforcementMode?previous?.enforcementSince:new Date().toISOString()};d.write(s);audit(req,'FLEET_POLICY_UPDATED',String(req.params.id));res.json({ok:true});
  });
  const fingerprint=(a:SshAccount)=>sha(JSON.stringify([a.id,a.nodeId,a.enabled,a.usedBytes,a.quotaBytes,a.expiresAt,a.provisionState,a.resellerId,a.label,a.maxConnections,a.password]));
  app.post('/api/v1/admin/fleet/migrations/preview',d.authenticate,admin,(req,res)=>{
    const a=d.ssh().accounts.find(a=>a.id===req.body?.accountId),target=d.nodes().find(n=>n.id===req.body?.targetNodeId);
    if(!a||!a.managed||!target||target.id===a.nodeId)return res.status(400).json({error:'Client ou destination invalide.'});
    if(a.enabled||a.provisionState!=='blocked'||!a.lastAppliedAt||Date.now()-Date.parse(a.lastAppliedAt)>60000)return res.status(409).json({error:'Suspendez d’abord le client et attendez la confirmation du serveur source.'});
    const s=d.read(),row=fleetRows([target],d.ssh().accounts,s)[0];if(!row?.online||!row.acceptNew||!row.available)return res.status(409).json({error:'Serveur cible indisponible ou complet.'});
    for(const [id,plan] of Object.entries(s.migrations))if(plan.expires<Date.now())delete s.migrations[id];
    const id=crypto.randomUUID();s.migrations[id]={accountId:a.id,sourceId:a.nodeId!,targetId:target.id,expires:Date.now()+240000,actor:(req as any).user.id,fingerprint:fingerprint(a)};d.write(s);
    res.json({id,accountId:a.id,sourceId:a.nodeId,targetId:target.id,expiresAt:new Date(Date.now()+240000).toISOString(),requiresNewConfiguration:true,message:'Le client restera suspendu. Réactivez-le et fournissez sa nouvelle configuration après le provisionnement.'});
  });
  app.post('/api/v1/admin/fleet/migrations/:id/commit',d.authenticate,admin,(req,res)=>{
    const s=d.read(),plan=s.migrations[String(req.params.id)],ssh=d.ssh(),a=ssh.accounts.find(a=>a.id===plan?.accountId);
    if(req.body?.confirmed!==true||!plan||plan.actor!==(req as any).user.id||plan.expires<Date.now()||!a||!a.lastAppliedAt||Date.now()-Date.parse(a.lastAppliedAt)>60000||fingerprint(a)!==plan.fingerprint)return res.status(409).json({error:'Prévisualisation expirée ou client modifié. Recommencez.'});
    const target=d.nodes().find(n=>n.id===plan.targetId),row=target&&fleetRows([target],ssh.accounts,s)[0];if(!row?.online||!row.acceptNew||!row.available)return res.sendStatus(409);
    a.nodeId=plan.targetId;a.provisionState='pending';a.lastAppliedAt=undefined;a.online=undefined;a.connection={...a.connection!,host:target!.host,sni:target!.sshWsSni||target!.host,port:target!.sshWsPort||443,path:target!.sshWsPath||'/ssh-ws',fingerprint:target!.sshWsFingerprint||a.connection?.fingerprint||''};
    d.saveSsh(ssh);delete s.migrations[String(req.params.id)];d.write(s);audit(req,'SSH_MIGRATED',JSON.stringify({id:a.id,source:plan.sourceId,target:plan.targetId}));res.json({ok:true,account:safeSshAccount(a)});
  });
  const cookie=(req:any)=>String(req.headers.cookie||'').split(';').map((v:string)=>v.trim()).find((v:string)=>v.startsWith('abess_client='))?.slice(13)||'';
  const cookieOptions={httpOnly:true,sameSite:'strict' as const,secure:process.env.COOKIE_SECURE!=='false',path:'/api/v1/portal',maxAge:12*3600000};
  const portalAuth:RequestHandler=(req,res,next)=>{
    res.set('Cache-Control','no-store');const token=cookie(req);if(!/^[a-f0-9]{64}$/.test(token))return res.sendStatus(401);
    const session=d.sessions()[sha(token)],a=d.ssh().accounts.find(a=>a.id===session?.accountId);
    if(!session||session.expires<Date.now()||!a||sha(a.password)!==session.passwordHash||!d.ownerActive(a.resellerId))return res.sendStatus(401);
    (req as any).clientAccount=a;next();
  };
  const clientActor=(a:SshAccount):Actor=>({id:'client:'+a.id,name:a.label,role:'CLIENT'});
  app.post('/api/v1/portal/login',d.limiter,(req,res)=>{
    const ip=req.ip||'';if(!d.guard(ip))return res.sendStatus(429);
    const username=String(req.body?.username||''),password=req.body?.password;
    const a=d.ssh().accounts.find(a=>a.username===username&&a.managed);let correct=false;
    if(a&&typeof password==='string'&&password.length<=96){try{correct=crypto.timingSafeEqual(Buffer.from(sha(password)),Buffer.from(sha(unseal(a.password,d.key))))}catch{}}
    if(!a||!correct||!d.ownerActive(a.resellerId)){d.failure(ip);return res.status(401).json({error:'Identifiants non reconnus.'})}
    const sessions=d.sessions(),now=Date.now();for(const [key,s] of Object.entries(sessions))if(s.expires<now||s.accountId===a.id)delete sessions[key];
    if(Object.keys(sessions).length>=5000)return res.sendStatus(503);
    const token=crypto.randomBytes(32).toString('hex');sessions[sha(token)]={accountId:a.id,passwordHash:sha(a.password),expires:now+12*3600000};d.saveSessions(sessions);
    res.cookie('abess_client',token,cookieOptions);res.set('Cache-Control','no-store').json({ok:true,account:safeSshAccount(a)});
  });
  app.post('/api/v1/portal/logout',portalAuth,(req,res)=>{const sessions=d.sessions();delete sessions[sha(cookie(req))];d.saveSessions(sessions);res.clearCookie('abess_client',{httpOnly:cookieOptions.httpOnly,sameSite:cookieOptions.sameSite,secure:cookieOptions.secure,path:cookieOptions.path}).json({ok:true})});
  app.get('/api/v1/portal/me',portalAuth,(req,res)=>{const a=(req as any).clientAccount;res.json({account:safeSshAccount(a),owner:d.users().filter(u=>u.id===a.resellerId).map(u=>({name:u.name}))[0]||null,history:history([a],30)})});
  app.get('/api/v1/portal/config',portalAuth,(req,res)=>{
    const a:SshAccount=(req as any).clientAccount,node=d.nodes().find(n=>n.id===a.nodeId);
    if(!a.enabled||Date.parse(a.expiresAt)<=Date.now()||a.usedBytes>=a.quotaBytes||a.provisionState!=='active'||!node||!nodeOnline(node))return res.status(409).json({error:'Licence inactive ou serveur indisponible.'});
    d.audit({actor:'client:'+a.id,role:'CLIENT',action:'SSH_CREDENTIALS_EXPORTED',details:a.id});res.json(exportSshAccount(a,node,d.key));
  });
  app.get('/api/v1/portal/tickets',portalAuth,(req,res)=>{const id='client:'+(req as any).clientAccount.id;res.json({tickets:d.read().tickets.filter(t=>t.createdBy===id)})});
  app.post('/api/v1/portal/tickets',portalAuth,(req,res)=>{try{const a=(req as any).clientAccount;res.status(201).json(createTicket(clientActor(a),req.body,a.id))}catch(e){res.status(400).json({error:(e as Error).message})}});
  app.post('/api/v1/portal/tickets/:id/messages',portalAuth,(req,res)=>{try{const actor=clientActor((req as any).clientAccount),t=reply(actor,String(req.params.id),req.body,t=>t.createdBy===actor.id);return t?res.json(t):res.sendStatus(404)}catch(e){res.status(400).json({error:(e as Error).message})}});
  app.get('/api/v1/portal/announcements',portalAuth,(req,res)=>{const actor=clientActor((req as any).clientAccount);res.json({announcements:d.announcements().filter(a=>visibleNotice(a,actor,'WEB')).sort((a,b)=>b.priority-a.priority).map(a=>({...publicNotice(a),receipt:d.receipts()[receiptKey(a,actor)]||{}}))})});
  app.post('/api/v1/portal/announcements/:id/receipt',portalAuth,(req,res)=>{
    const actor=clientActor((req as any).clientAccount),a=d.announcements().find(a=>a.id===req.params.id&&visibleNotice(a,actor,'WEB'));
    if(!a)return res.sendStatus(404);const action=req.body?.action;if(!['read','acknowledge','dismiss','click'].includes(action))return res.sendStatus(400);
    if(action==='dismiss'&&(a.isMandatory||!a.dismissible))return res.sendStatus(409);
    const receipts=d.receipts(),key=receiptKey(a,actor),row=receipts[key]||{},now=new Date().toISOString();row.readAt||=now;
    if(action==='acknowledge')row.acknowledgedAt||=now;if(action==='dismiss')row.dismissedAt||=now;if(action==='click')row.clickedAt||=now;
    receipts[key]=row;d.saveReceipts(receipts);res.json({ok:true,receipt:row});
  });
  return {refreshNotifications:()=>{const s=d.read();for(const actor of d.users().filter(u=>u.status==='active'&&(s.preferences[u.id]?.telegram||s.preferences[u.id]?.email)))buildAlerts(actor)}};
}

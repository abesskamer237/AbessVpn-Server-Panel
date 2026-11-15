import crypto from 'node:crypto';
import type {Express,RequestHandler} from 'express';

export type Audience='PUBLIC'|'ALL_USERS'|'RESELLERS'|'ADMINS'|'SELECTED_USERS'|'CLIENTS';
export type Notice={id:string;title:string;message:string;type:string;targetPlatform:string;isMandatory:boolean;dismissible:boolean;publishedAt:string;expiresAt?:string;startsAt?:string;isActive:boolean;priority:number;showMode:string;createdBy?:string;actionButtonText?:string;actionButtonUrl?:string;bannerImageUrl?:string;status?:'DRAFT'|'PUBLISHED'|'ARCHIVED';audience?:Audience;userIds?:string[];revision?:number;updatedAt?:string};
export type NoticeActor={id:string;role:string};
export type NoticeReceipts=Record<string,{readAt?:string;acknowledgedAt?:string;dismissedAt?:string;clickedAt?:string}>;
const types=['INFO','WARNING','CRITICAL','PROMO','UPDATE'];
const platforms=['ALL','WEB','ANDROID','WINDOWS'];
const audiences:Audience[]=['PUBLIC','ALL_USERS','RESELLERS','ADMINS','SELECTED_USERS','CLIENTS'];
export function activeNotice(a:Notice,now=Date.now()){
  return a.status!=='DRAFT'&&a.status!=='ARCHIVED'&&a.isActive&&(!a.startsAt||Date.parse(a.startsAt)<=now)&&(!a.expiresAt||Date.parse(a.expiresAt)>now);
}
export function visibleNotice(a:Notice,actor?:NoticeActor,platform='WEB',now=Date.now()){
  if(!activeNotice(a,now)||!['ALL',platform].includes(a.targetPlatform))return false;
  switch(a.audience||'PUBLIC'){
    case 'PUBLIC':return true;
    case 'CLIENTS':return actor?.role==='CLIENT';
    case 'ALL_USERS':return Boolean(actor);
    case 'RESELLERS':return actor?.role==='RESELLER';
    case 'ADMINS':return actor?.role==='ADMIN'||actor?.role==='SUPER_ADMIN';
    case 'SELECTED_USERS':return Boolean(actor&&a.userIds?.includes(actor.id));
    default:return false;
  }
}
const iso=(v:unknown)=>{if(v===undefined||v===null||v==='')return undefined;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw Error('Date invalide.');return new Date(v).toISOString()};
function link(v:unknown,image=false){
  if(v===null||v==='')return undefined;
  if(typeof v!=='string'||v.length>2048)throw Error('Lien invalide.');
  const url=new URL(v,'https://panel.invalid');
  if(url.protocol!=='https:'||url.username||url.password||v.startsWith('//')||(image&&url.hostname==='panel.invalid'))throw Error('Utilisez un lien HTTPS valide.');
  return v;
}
export function validateNotice(body:any,previous?:Notice):Notice{
  const b={...previous,...body};
  const title=typeof b.title==='string'?b.title.trim():'';
  const message=typeof b.message==='string'?b.message.trim():'';
  if(!title||title.length>160||!message||message.length>10000)throw Error('Titre (160 caractères maximum) et message (10 000 maximum) requis.');
  if(b.type!==undefined&&!types.includes(b.type))throw Error('Type d’annonce invalide.');
  if(b.targetPlatform!==undefined&&!platforms.includes(b.targetPlatform))throw Error('Plateforme invalide.');
  if(b.audience!==undefined&&!audiences.includes(b.audience))throw Error('Audience invalide.');
  if(b.status!==undefined&&!['DRAFT','PUBLISHED','ARCHIVED'].includes(b.status))throw Error('Statut invalide.');
  for(const key of ['isActive','isMandatory','dismissible'])if(b[key]!==undefined&&typeof b[key]!=='boolean')throw Error('Option invalide : '+key);
  if(b.priority!==undefined&&(!Number.isInteger(b.priority)||Math.abs(b.priority)>100))throw Error('Priorité invalide (-100 à 100).');
  if(b.showMode!==undefined&&!['EVERY_LAUNCH','ONCE_PER_USER'].includes(b.showMode))throw Error('Fréquence invalide.');
  const startsAt=iso(b.startsAt),expiresAt=iso(b.expiresAt);
  if(startsAt&&expiresAt&&Date.parse(expiresAt)<=Date.parse(startsAt))throw Error('La fin doit être postérieure au début.');
  const audience=b.audience||'PUBLIC';
  if(audience!=='PUBLIC'&&b.targetPlatform!==undefined&&!['ALL','WEB'].includes(b.targetPlatform))throw Error('Le ciblage privé est disponible sur le site et le portail ; choisissez Site web ou Toutes.');
  const userIds=b.userIds??[];
  if(!Array.isArray(userIds)||userIds.length>500||userIds.some((v:any)=>typeof v!=='string'||v.length>100))throw Error('Destinataires invalides.');
  if(audience==='SELECTED_USERS'&&!userIds.length)throw Error('Sélectionnez au moins un destinataire.');
  const actionButtonText=typeof b.actionButtonText==='string'?b.actionButtonText.trim():undefined;
  if(actionButtonText&&actionButtonText.length>80)throw Error('Libellé du bouton trop long.');
  const actionButtonUrl=link(b.actionButtonUrl??'');
  if(Boolean(actionButtonText)!==Boolean(actionButtonUrl))throw Error('Renseignez le libellé et le lien du bouton.');
  return {id:previous?.id||'ann-'+crypto.randomUUID(),title,message,type:b.type||'INFO',targetPlatform:b.targetPlatform||'ALL',
    isMandatory:b.isMandatory??false,dismissible:b.isMandatory?false:(b.dismissible??true),
    isActive:b.isActive??true,status:b.status||(b.isActive===false?'DRAFT':'PUBLISHED'),audience,userIds:[...new Set(userIds)] as string[],
    startsAt,expiresAt,publishedAt:previous?.publishedAt||new Date().toISOString(),updatedAt:new Date().toISOString(),
    revision:(previous?.revision||0)+1,priority:b.priority??0,showMode:b.showMode||'ONCE_PER_USER',actionButtonText,actionButtonUrl,
    bannerImageUrl:link(b.bannerImageUrl??'',true),createdBy:previous?.createdBy};
}
export const receiptKey=(a:Notice,actor:NoticeActor)=>a.id+':'+(a.revision||1)+':'+actor.id;
export const publicNotice=(a:Notice)=>{const {userIds,createdBy,...safe}=a;try{safe.actionButtonUrl=link(a.actionButtonUrl??'')}catch{safe.actionButtonUrl=undefined;safe.actionButtonText=undefined}try{safe.bannerImageUrl=link(a.bannerImageUrl??'',true)}catch{safe.bannerImageUrl=undefined}return safe};
export function registerAnnouncements(app:Express,d:{authenticate:RequestHandler;limiter:RequestHandler;read:()=>Notice[];write:(v:Notice[])=>void;receipts:()=>NoticeReceipts;saveReceipts:(v:NoticeReceipts)=>void;users:()=>{id:string;role:string;name:string}[];audit:(v:any)=>void}){
  const superAdmin:RequestHandler=(req,res,next)=>(req as any).user.role==='SUPER_ADMIN'?next():void res.sendStatus(403);
  const ordered=(list:Notice[])=>list.sort((a,b)=>b.priority-a.priority||Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  app.get(['/api/v1/announcements/active','/api/v1/app/announcements'],d.limiter,(req,res)=>{
    const platform=String(req.query.platform||'ALL').toUpperCase();
    if(!platforms.includes(platform))return res.status(400).json({error:'Plateforme invalide.'});
    // Public endpoints must never return role-targeted announcements.
    const announcements=ordered(d.read().filter(a=>activeNotice(a)&&(a.audience||'PUBLIC')==='PUBLIC'&&(platform==='ALL'||['ALL',platform].includes(a.targetPlatform)))).map(publicNotice);
    res.set('Cache-Control','no-store').json({ok:true,count:announcements.length,announcements});
  });
  app.get('/api/v1/announcements/feed',d.authenticate,(req,res)=>{
    const actor=(req as any).user,receipts=d.receipts();
    const announcements=ordered(d.read().filter(a=>visibleNotice(a,actor))).map(a=>({...publicNotice(a),receipt:receipts[receiptKey(a,actor)]||{}}));
    res.set('Cache-Control','no-store').json({ok:true,announcements});
  });
  app.post('/api/v1/announcements/:id/receipt',d.authenticate,(req,res)=>{
    const actor=(req as any).user,a=d.read().find(a=>a.id===req.params.id);
    if(!a||!visibleNotice(a,actor))return res.sendStatus(404);
    const action=req.body?.action;
    if(!['read','acknowledge','dismiss','click'].includes(action))return res.sendStatus(400);
    if(action==='dismiss'&&(a.isMandatory||!a.dismissible))return res.status(409).json({error:'Cette annonce nécessite un accusé de lecture.'});
    const receipts=d.receipts(),key=receiptKey(a,actor),row=receipts[key]||{};
    const now=new Date().toISOString();row.readAt||=now;
    if(action==='acknowledge')row.acknowledgedAt||=now;
    if(action==='dismiss')row.dismissedAt||=now;
    if(action==='click')row.clickedAt||=now;
    receipts[key]=row;d.saveReceipts(receipts);res.json({ok:true,receipt:row});
  });
  app.get('/api/v1/admin/announcements',d.authenticate,superAdmin,(_req,res)=>{
    const receipts=d.receipts();
    res.json({ok:true,announcements:ordered(d.read()).map(a=>{
      const rows=Object.entries(receipts).filter(([key])=>key.startsWith(a.id+':'+(a.revision||1)+':')).map(([,r])=>r);
      return {...a,stats:{read:rows.filter(r=>r.readAt).length,acknowledged:rows.filter(r=>r.acknowledgedAt).length,clicked:rows.filter(r=>r.clickedAt).length,dismissed:rows.filter(r=>r.dismissedAt).length}};
    }),recipients:d.users().map(u=>({id:u.id,name:u.name,role:u.role}))});
  });
  const save=(edit:boolean):RequestHandler=>(req,res)=>{
    const list=d.read(),previous=edit?list.find(a=>a.id===req.params.id):undefined;
    if(edit&&!previous)return void res.sendStatus(404);
    if(!edit&&list.length>=1000)return void res.status(409).json({error:'Archivez puis supprimez des annonces pour en ajouter.'});
    try{
      const a=validateNotice(req.body,previous);
      if(a.userIds?.some(id=>!d.users().some(u=>u.id===id)))throw Error('Destinataire introuvable.');
      a.createdBy=previous?.createdBy||(req as any).user.name;
      d.write(previous?list.map(x=>x.id===a.id?a:x):[a,...list]);
      d.audit({action:edit?'ANNOUNCEMENT_UPDATED':'ANNOUNCEMENT_CREATED',actor:(req as any).user.id,role:'SUPER_ADMIN',details:JSON.stringify({id:a.id,revision:a.revision,status:a.status,audience:a.audience})});
      res.status(edit?200:201).json({ok:true,announcement:a});
    }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Annonce invalide.'})}
  };
  app.post('/api/v1/admin/announcements',d.authenticate,superAdmin,save(false));
  app.put('/api/v1/admin/announcements/:id',d.authenticate,superAdmin,save(true));
  app.post('/api/v1/admin/announcements/:id/duplicate',d.authenticate,superAdmin,(req,res)=>{
    const list=d.read(),old=list.find(a=>a.id===req.params.id);if(!old)return res.sendStatus(404);
    if(list.length>=1000)return res.sendStatus(409);
    const a=validateNotice({...old,title:old.title.slice(0,150)+' (copie)',status:'DRAFT',isActive:false,id:undefined});
    a.createdBy=(req as any).user.name;d.write([a,...list]);d.audit({action:'ANNOUNCEMENT_DUPLICATED',actor:(req as any).user.id,role:'SUPER_ADMIN',details:a.id});res.status(201).json({ok:true,announcement:a});
  });
  app.delete('/api/v1/admin/announcements/:id',d.authenticate,superAdmin,(req,res)=>{
    const list=d.read(),a=list.find(a=>a.id===req.params.id);if(!a)return res.sendStatus(404);
    if(a.status!=='ARCHIVED')return res.status(409).json({error:'Archivez l’annonce avant sa suppression définitive.'});
    d.write(list.filter(x=>x.id!==a.id));const receipts=d.receipts();for(const key of Object.keys(receipts))if(key.startsWith(a.id+':'))delete receipts[key];d.saveReceipts(receipts);
    d.audit({action:'ANNOUNCEMENT_DELETED',actor:(req as any).user.id,role:'SUPER_ADMIN',details:a.id});res.sendStatus(204);
  });
}

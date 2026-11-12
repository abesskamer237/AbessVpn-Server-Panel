import crypto from 'node:crypto';
import type {Express, RequestHandler} from 'express';
import type {VpnNode} from './operations.js';
import {seal, unseal} from './security.js';

export const SSH_MODES = ['tcp','ws','ws-alt','ws-framed','wss-raw','wss-raw-alt','wss','wss-alt'] as const;
export interface SshConnection {
  host: string; port: number; transport: string; fingerprint: string;
  tls: boolean; sni: string | null; path: string; wire: string; hasPayload: boolean;
}
export interface SshAccount {
  id: string; username: string; label: string;
  salt?: string; verifier?: string; nodeId?: string; connection?: SshConnection;
  resellerId?: string; resellerName?: string; renewalIds?: string[]; renewalRequests?: Record<string,{gb:number;days:number}>;
  usageObservedAt?: string;
  online?: number; password: string; payload?: string;
  quotaBytes: number; usedBytes: number; maxConnections: number;
  expiresAt: string; enabled: boolean; createdAt: string;
}
export interface SshState { accounts: SshAccount[] }
export function safeSshAccount(a: SshAccount) {
  const {password, payload, salt, verifier, renewalIds, renewalRequests, ...safe} = a;
  return {...safe,trafficVerified:Boolean(a.usageObservedAt),usedBytes:a.usageObservedAt?a.usedBytes:null,online:a.usageObservedAt?a.online??null:null};
}
export function sshPayload(host: string, port = 80, pathname = '/ws-ssh') {
  const authority = [80,443].includes(port) ? host : `${host}:${port}`;
  return `GET ${pathname} HTTP/1.1[crlf]Host: ${authority}[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]`;
}
export function validSshPayload(payload: unknown): payload is string {
  return typeof payload === 'string' && payload.length > 0 && payload.length <= 8192 &&
    !/[^\x20-\x7e\r\n\t]/.test(payload) && /^(CONNECT|GET|POST|HEAD|OPTIONS|PUT|PATCH|DELETE) /.test(payload) &&
    !/\[(?!(?:crlf|cr|lf|host|port|host_port|protocol|ua)\])[^\]]+\]/i.test(payload);
}
type User = {id:string; name:string; role:string; status:string};
export function registerSsh(app:Express,d:{
  authenticate:RequestHandler; read:()=>SshState; write:(s:SshState)=>void;
  audit:(event:any)=>void; key:string; nodes:()=>VpnNode[];
  users:()=>User[]; canManage:(actor:any, ownerId:string)=>boolean;
  ownerActive:(ownerId?:string)=>boolean;
  charge:(payerId:string, quotaGb:number, id:string, renewal:boolean)=>boolean;
}) {
  const admin:RequestHandler=(req,res,next)=>{if((req as any).user.role!=='SUPER_ADMIN')return res.sendStatus(403);next();};
  const ready=(id?:string)=>d.nodes().some(n=>n.id===id&&n.enabled&&n.ready&&Date.now()-Date.parse(n.observedAt||'')>=-5000&&Date.now()-Date.parse(n.observedAt||'')<=60000);
  const allowed=(actor:any,a:SshAccount)=>actor.role==='SUPER_ADMIN'||Boolean(a.resellerId&&d.canManage(actor,a.resellerId));
  const active=(a:SshAccount)=>a.enabled&&Number.isFinite(Date.parse(a.expiresAt))&&Date.parse(a.expiresAt)>Date.now()&&a.usedBytes<a.quotaBytes&&d.ownerActive(a.resellerId);
  app.get('/api/v1/admin/ssh',d.authenticate,(req,res)=>{
    const actor=(req as any).user, isAdmin=actor.role==='SUPER_ADMIN';
    res.json({enabled:true,ready:d.nodes().some(n=>ready(n.id)),
      nodes:isAdmin?d.nodes().filter(n=>n.enabled).map(n=>({id:n.id,name:n.name,host:n.host})):[],
      resellers:isAdmin?d.users().filter(u=>u.status==='active').map(u=>({id:u.id,name:u.name})):[],
      accounts:d.read().accounts.filter(a=>allowed(actor,a)).map(a=>({...safeSshAccount(a),
        connection:isAdmin?a.connection:a.connection?{transport:a.connection.transport,port:a.connection.port,hasPayload:a.connection.hasPayload}:undefined,
        ready:ready(a.nodeId),effectiveEnabled:active(a),
        trafficVerified:Boolean(a.usageObservedAt),usedBytes:a.usageObservedAt?a.usedBytes:null,
        online:ready(a.nodeId)&&a.usageObservedAt?a.online||0:null}))});
  });
  // Resellers may register *existing* supplier credentials, never provision system users.
  // Only Super Admin may associate a record with a managed VPS/node.
  app.post('/api/v1/admin/ssh/accounts',d.authenticate,(req,res)=>{
    const actor=(req as any).user;
    const nodeId=String(req.body?.nodeId||'')||undefined, node=nodeId?d.nodes().find(n=>n.id===nodeId&&n.enabled):undefined, config=req.body?.config;
    if (actor.role !== 'SUPER_ADMIN' && nodeId) return res.sendStatus(403);
    if((nodeId&&!node)||!config||typeof config.host!=='string'||!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(config.host)||
      (node&&config.host!==node.host)||!SSH_MODES.includes(config.transport)||
      !Number.isInteger(config.port)||config.port<1||config.port>65535||
      typeof config.password!=='string'||!config.password.length||config.password.length>1024||
      typeof config.fingerprint!=='string'||!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(config.fingerprint)||
      (config.transport.startsWith('wss')&&(config.tls!==true||typeof config.sni!=='string'||!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(config.sni)))||
      (config.path!==undefined&&(typeof config.path!=='string'||!config.path.startsWith('/')||config.path.startsWith('//')||config.path.length>2048||/[\r\n\x00]/.test(config.path)))||
      (config.payload!==undefined&&config.payload!==null&&config.payload!==''&&!validSshPayload(config.payload))||
      (['ws-framed','wss','wss-alt'].includes(config.transport)&&Boolean(config.payload))) {
      return res.status(400).json({error:'Configuration SSH invalide.'});
    }
    const username=String(config.username||'').trim(),label=String(req.body?.label||username).trim();
    const days=Number(req.body?.days),quotaGb=Number(req.body?.quotaGb),maxConnections=Number(req.body?.maxConnections);
    // A reseller cannot charge another account or assign a supplier record to a sibling.
    const ownerId=actor.role==='SUPER_ADMIN'?String(req.body?.resellerId||actor.id):actor.id;
    const owner=d.users().find(u=>u.id===ownerId&&u.status==='active');
    if(!owner||!d.ownerActive(ownerId)||!/^[a-z][a-z0-9_-]{2,31}$/.test(username)||label.length>80||
      !Number.isInteger(days)||days<1||days>366||!Number.isFinite(quotaGb)||quotaGb<0.01||quotaGb>100000||
      !Number.isInteger(maxConnections)||maxConnections<1||maxConnections>10)return res.status(400).json({error:'Client, durée, quota ou connexions invalides.'});
    const state=d.read();
    if(state.accounts.length>=5000||state.accounts.some(a=>a.username===username&&a.connection?.host.toLowerCase()===config.host.toLowerCase()))return res.status(409).json({error:'Utilisateur déjà présent ou capacité atteinte.'});
    const payload=config.payload||'';
    const account:SshAccount={id:'ssh_'+crypto.randomUUID(),username,label,nodeId,resellerId:owner.id,resellerName:owner.name,
      connection:{host:config.host,port:config.port,transport:config.transport,fingerprint:config.fingerprint.replace(/=+$/,''),
        tls:config.transport.startsWith('wss'),sni:config.transport.startsWith('wss')?config.sni:null,path:config.path||'/ws-ssh',
        hasPayload:Boolean(payload),wire:config.transport==='tcp'?(payload?'http-connect':'ssh'):['ws-framed','wss','wss-alt'].includes(config.transport)?'websocket':'http-upgrade'},
      password:seal(config.password,d.key),...(payload?{payload:seal(payload,d.key)}:{}),
      quotaBytes:Math.round(quotaGb*1024**3),usedBytes:0,maxConnections,enabled:true,
      createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+days*86400000).toISOString()};
    if(!d.charge(owner.id,quotaGb,account.id,false))return res.status(409).json({error:'Solde insuffisant ou compte indisponible.'});
    state.accounts.push(account);d.write(state);d.audit({action:'SSH_IMPORTED',actor:actor.id,role:actor.role,details:JSON.stringify({id:account.id,ownerId:owner.id,quotaGb,days})});
    res.status(201).json(safeSshAccount(account));
  });
  app.post('/api/v1/admin/ssh/accounts/:id/renew',d.authenticate,(req,res)=>{
    const actor=(req as any).user,state=d.read(),a=state.accounts.find(a=>a.id===req.params.id);
    if(!a)return res.sendStatus(404);if(!allowed(actor,a))return res.sendStatus(403);
    const key=String(req.headers['idempotency-key']||''),gb=Number(req.body?.additionalGb),days=Number(req.body?.days);
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(key)||!Number.isFinite(gb)||gb<0.01||gb>100000||!Number.isInteger(days)||days<1||days>366)return res.status(400).json({error:'Renouvellement invalide.'});
    const id=crypto.createHash('sha256').update(actor.id+':'+key).digest('hex');
    if(a.renewalIds?.includes(id)){
      const previous=a.renewalRequests?.[id];
      if(previous&&(previous.gb!==gb||previous.days!==days))return res.status(409).json({error:'Clé de renouvellement déjà utilisée.'});
      return res.json(safeSshAccount(a));
    }
    if(!a.enabled||!d.ownerActive(a.resellerId))return res.status(409).json({error:'Compte suspendu.'});
    const quota=a.quotaBytes+Math.round(gb*1024**3);
    if(!Number.isSafeInteger(quota)||quota>1000000*1024**3)return res.status(400).json({error:'Quota total trop élevé.'});
    if(!d.charge(actor.role==='SUPER_ADMIN'?(a.resellerId||actor.id):actor.id,gb,a.id,true))return res.status(409).json({error:'Solde insuffisant ou compte indisponible.'});
    a.quotaBytes=quota;a.expiresAt=new Date(Math.max(Date.now(),Date.parse(a.expiresAt)||0)+days*86400000).toISOString();
    a.renewalIds=[...(a.renewalIds||[]),id];a.renewalRequests={...a.renewalRequests,[id]:{gb,days}};d.write(state);d.audit({action:'SSH_RENEWED',actor:actor.id,role:actor.role,details:JSON.stringify({id:a.id,additionalGb:gb,days})});
    res.json(safeSshAccount(a));
  });
  app.patch('/api/v1/admin/ssh/accounts/:id',d.authenticate,(req,res)=>{
    const state=d.read(),a=state.accounts.find(a=>a.id===req.params.id),actor=(req as any).user;
    if(!a)return res.sendStatus(404);if(!allowed(actor,a))return res.sendStatus(403);
    if(typeof req.body?.enabled!=='boolean')return res.sendStatus(400);
    if(req.body.enabled&&(Date.parse(a.expiresAt)<=Date.now()||a.usedBytes>=a.quotaBytes||!d.ownerActive(a.resellerId)))return res.status(409).json({error:'Renouvelez le compte avant réactivation.'});
    a.enabled=req.body.enabled;d.write(state);d.audit({action:a.enabled?'SSH_ENABLED':'SSH_DISABLED',actor:actor.id,role:actor.role,details:a.id});res.json(safeSshAccount(a));
  });
  app.delete('/api/v1/admin/ssh/accounts/:id',d.authenticate,admin,(req,res)=>{
    const state=d.read(),index=state.accounts.findIndex(a=>a.id===req.params.id);if(index<0)return res.sendStatus(404);
    state.accounts.splice(index,1);d.write(state);d.audit({action:'SSH_DELETED',actor:(req as any).user.id,role:(req as any).user.role,details:String(req.params.id)});res.sendStatus(204);
  });
  app.post('/api/v1/admin/ssh/accounts/:id/config',d.authenticate,(req,res)=>{
    const a=d.read().accounts.find(a=>a.id===req.params.id),actor=(req as any).user;
    if(!a)return res.sendStatus(404);if(!allowed(actor,a))return res.sendStatus(403);
    if(!a.connection||req.body?.transport!==a.connection.transport)return res.sendStatus(400);
    if(!active(a))return res.status(503).json({error:'Accès SSH indisponible.'});
    const {hasPayload,...connection}=a.connection;
    d.audit({action:'SSH_CREDENTIALS_EXPORTED',actor:actor.id,role:actor.role,details:a.id});
    res.set('Cache-Control','no-store').json({format:'abess-ssh-v1',protocol:'ssh',...connection,username:a.username,password:unseal(a.password,d.key),
      payload:a.payload?unseal(a.payload,d.key):a.connection.wire==='http-upgrade'?sshPayload(a.connection.tls?(a.connection.sni||a.connection.host):a.connection.host,a.connection.port,a.connection.path):null,
      expiresAt:a.expiresAt,quotaGb:a.quotaBytes/1024**3,usedGb:a.usageObservedAt?a.usedBytes/1024**3:null,trafficVerified:Boolean(a.usageObservedAt)});
  });
}

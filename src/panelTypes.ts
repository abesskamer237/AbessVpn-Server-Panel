export type Role='SUPER_ADMIN'|'ADMIN'|'RESELLER';

export type User={
  id:string;name:string;email:string;role:Role;credits:number;
  totalTokensCreated?:number;totalBandwidthAllocatedGb?:number;
};

export type HostTelemetry={
  observedAt:string;uptimeSeconds:number;cpuPercent:number;load1:number;
  totalMemoryBytes:number;freeMemoryBytes:number;
  diskTotalBytes:number;diskFreeBytes:number;
  services:{sshd:boolean;gateway:boolean;reconciler:boolean};
};

export type ManagedNode={
  id:string;name:string;host:string;sni?:string;port:number;path:string;
  agentOnline:boolean;hostTelemetry?:HostTelemetry|null;
};

export type SshAccount={
  id:string;username:string;label:string;nodeId:string;managed:boolean;
  provisionState:'pending'|'active'|'blocked'|'error'|string;
  enabled:boolean;expiresAt:string;quotaBytes:number;usedBytes:number|null;
  online:number|null;maxConnections:number;trafficVerified:boolean;effectiveEnabled:boolean;
  ready?:boolean;createdAt:string;resellerId?:string;resellerName?:string;
  connection?:{host?:string;transport:string;port:number};
};

export type SshInventory={
  enabled:boolean;sshWsReady:boolean;ready?:boolean;
  managedNodes:ManagedNode[];accounts:SshAccount[];
};

export type Reseller={
  id:string;name:string;email:string;credits:number;status:'active'|'suspended'|string;
  createdAt?:string;lastLoginAt?:string|null;parentId?:string;parentName?:string;
  totalTokensCreated?:number;totalBandwidthAllocatedGb?:number;subResellersCount?:number;
  pricePerGbCfa?:number;costPerGbCfa?:number;pricePerLicenceCfa?:number;
};

export type Operator={
  id:string;name:string;email:string;role:'ADMIN';status:'active'|'suspended';
  createdAt:string;lastLoginAt?:string|null;
};

export type Transaction={
  id:string;resellerId?:string;resellerName:string;type:string;amountGb:number;
  balanceBefore:number;balanceAfter:number;note:string;timestamp:string;
};

export type AuditEvent={
  id:string;timestamp:string;actor?:string;role?:string;action:string;details?:string;
};

export type OpsHealth={
  ok?:boolean;alerts?:string[];storage?:string;freeBytes?:number;uptimeSeconds?:number;
  memoryBytes?:number;loadAverage?:number[];backup?:{at:string;offsite:boolean;error?:string}|null;
};

export const bytesToGb=(n:number|null|undefined)=>Number((Number(n||0)/1024**3).toFixed(2));
export const fmtGb=(n:number|null|undefined)=>bytesToGb(n).toLocaleString('fr-FR',{maximumFractionDigits:2})+' Go';
export const fmtDate=(value?:string)=>value?new Date(value).toLocaleDateString('fr-FR'):'—';
export const fmtDateTime=(value?:string)=>value?new Date(value).toLocaleString('fr-FR'):'—';
export const percent=(used:number|null|undefined,total:number|null|undefined)=>{
  if(!total||total<=0)return 0;
  return Math.max(0,Math.min(100,Math.round((Number(used||0)/total)*100)));
};
export const accountStatus=(a:SshAccount)=>{
  const left=Date.parse(a.expiresAt)-Date.now();
  if(a.provisionState==='error')return {key:'error',label:'Erreur VPS',tone:'danger'};
  if(a.provisionState==='pending')return {key:'pending',label:'Provisionnement',tone:'info'};
  if(!a.enabled)return {key:'suspended',label:'Suspendu',tone:'warning'};
  if(Date.parse(a.expiresAt)<=Date.now())return {key:'expired',label:'Expiré',tone:'neutral'};
  if(a.usedBytes!==null&&a.usedBytes>=a.quotaBytes)return {key:'quota',label:'Quota épuisé',tone:'danger'};
  if(left<=3*86400000)return {key:'expiring',label:'Expire bientôt',tone:'warning'};
  if(a.effectiveEnabled)return {key:'active',label:'Actif',tone:'success'};
  return {key:'inactive',label:'Inactif',tone:'neutral'};
};
export const csvDownload=(filename:string,rows:(string|number|null|undefined)[][])=>{
  const esc=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
  const data='\ufeff'+rows.map(row=>row.map(esc).join(';')).join('\n');
  const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
};

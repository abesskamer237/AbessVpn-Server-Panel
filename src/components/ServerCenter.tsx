import {useState,type FormEvent} from 'react';
import {Activity,Database,Download,HardDrive,Plus,Server,ShieldCheck,X} from 'lucide-react';
import type {AuditEvent,ManagedNode,OpsHealth} from '../panelTypes';
import {fmtDateTime} from '../panelTypes';

type Props={
  nodes:(ManagedNode&{enabled?:boolean;sshWsManaged?:boolean;sshWsAgentSeenAt?:string})[];
  ops:OpsHealth|null;audit:AuditEvent[];busy:boolean;
  request:(url:string,method?:string,body?:unknown)=>Promise<any>;refresh:()=>Promise<void>;
};
const pct=(used:number,total:number)=>total>0?Math.max(0,Math.min(100,Math.round(used/total*100))):0;
const humanBytes=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(n/1024**3)+' Go';
const uptime=(sec:number)=>{
  const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600);
  return d?(d+' j '+h+' h'):(h+' h');
};

export function ServerCenter({nodes,ops,audit,busy,request,refresh}:Props){
  // Xray belongs to the retired VLESS data plane: its readiness is irrelevant in SSH-WSS production.
  const labels:Record<string,string>={POSTGRES_NOT_CONFIGURED:'PostgreSQL non configuré (mode développement)',OFFSITE_BACKUP_NOT_CONFIGURED:'Sauvegarde hors site (S3) non configurée',BACKUP_OVERDUE:'Aucune sauvegarde récente',LOW_DISK_SPACE:'Espace disque API faible',API_ERRORS:'Erreurs API récentes'};
  const alertLabels=(ops?.alerts||[]).filter(a=>a!=='XRAY_NOT_READY').map(a=>labels[a]||a.replaceAll('_',' ').toLowerCase());
  const tone=(v:number)=>v>=90?'var(--danger)':v>=75?'var(--warning)':undefined;
  const [add,setAdd]=useState(false),[name,setName]=useState(''),[host,setHost]=useState('');
  const [created,setCreated]=useState<{id:string,key:string}|null>(null),[error,setError]=useState('');
  const [configure,setConfigure]=useState<(ManagedNode&{sshWsManaged?:boolean})|null>(null);
  const [fingerprint,setFingerprint]=useState(''),[sni,setSni]=useState(''),[port,setPort]=useState(443),[wsPath,setWsPath]=useState('/ssh-ws');
  async function create(e:FormEvent){
    e.preventDefault();setError('');
    try{const x=await request('/api/v1/admin/nodes','POST',{name,host});setCreated(x);setName('');setHost('');await refresh()}
    catch(e){setError(e instanceof Error?e.message:'Création impossible')}
  }
  async function backup(){
    setError('');
    try{
      const data=await request('/api/v1/admin/operations/backup');
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='abess-backup-'+new Date().toISOString().slice(0,10)+'.encrypted.json';a.click();URL.revokeObjectURL(url);
    }catch(e){setError(e instanceof Error?e.message:'Sauvegarde impossible')}
  }
  async function activateNode(e:FormEvent){
    e.preventDefault();if(!configure)return;setError('');
    try{
      await request('/api/v1/admin/nodes/'+configure.id+'/ssh-ws','PUT',{enabled:true,fingerprint,sni:sni||configure.host,port,path:wsPath});
      setConfigure(null);setFingerprint('');setSni('');setPort(443);setWsPath('/ssh-ws');await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Activation SSH-WSS impossible')}
  }
  return <div className="stack">
    <div className="page-header"><div><h1>Serveurs</h1><p>Supervision temps réel des VPS et composants SSH-WSS.</p></div>
      <div className="page-actions"><button className="btn" onClick={()=>void backup()}><Download size={14}/>Sauvegarde chiffrée</button><button className="btn btn-primary" onClick={()=>{setAdd(true);setCreated(null)}}><Plus size={15}/>Ajouter un VPS</button></div>
    </div>
    {error&&<p className="notice" role="alert">{error}</p>}
    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><Server size={14}/>VPS gérés</div><div className="metric-value">{nodes.length}</div><div className="metric-foot">{nodes.filter(n=>n.agentOnline).length} agents connectés</div></div>
      <div className="card metric-card"><div className="metric-label"><Database size={14}/>Base de données</div><div className="metric-value" style={{fontSize:18}}>{ops?.storage||'—'}</div><div className="metric-foot">Stockage du panneau</div></div>
      <div className="card metric-card"><div className="metric-label"><HardDrive size={14}/>Disque API libre</div><div className="metric-value">{ops?.freeBytes?humanBytes(ops.freeBytes):'—'}</div><div className="metric-foot">Espace du conteneur de contrôle</div></div>
      <div className="card metric-card"><div className="metric-label"><ShieldCheck size={14}/>Sauvegarde</div><div className="metric-value" style={{fontSize:18}}>{ops?.backup?.at?'OK':'À vérifier'}</div><div className="metric-foot">{ops?.backup?.at?fmtDateTime(ops.backup.at):'Aucune sauvegarde confirmée'}</div></div>
    </div>

    <div className="server-grid">
      {nodes.map(n=>{const t=n.hostTelemetry;const mem=t?pct(t.totalMemoryBytes-t.freeMemoryBytes,t.totalMemoryBytes):0;const disk=t?pct(t.diskTotalBytes-t.diskFreeBytes,t.diskTotalBytes):0;
        return <section className="card card-pad" key={n.id}>
          <div className="section-head"><div><h2>{n.name}</h2><p>{n.sni||n.host}:{n.port||443}{n.path||'/ssh-ws'}</p></div><span className={'badge '+(!n.sshWsManaged?'badge-warning':n.agentOnline?'badge-success':'badge-danger')}>{!n.sshWsManaged?'À configurer':n.agentOnline?'En ligne':'Hors ligne'}</span></div>
          <div className="server-metrics">
            <div className="server-metric"><label>CPU</label><strong style={{color:t?tone(t.cpuPercent):undefined}}>{t?(t.cpuPercent.toFixed(1)+' %'):'—'}</strong></div>
            <div className="server-metric"><label>RAM</label><strong style={{color:tone(mem)}}>{t?(mem+' %'):'—'}</strong></div>
            <div className="server-metric"><label>Disque</label><strong style={{color:tone(disk)}}>{t?(disk+' %'):'—'}</strong></div>
            <div className="server-metric"><label>Uptime</label><strong>{t?uptime(t.uptimeSeconds):'—'}</strong></div>
          </div>
          {t&&<div style={{marginTop:12}}>
            <div className="service-line"><span>OpenSSH dédié</span><span className={'badge '+(t.services.sshd?'badge-success':'badge-danger')}>{t.services.sshd?'Actif':'Arrêté'}</span></div>
            <div className="service-line"><span>Gateway WebSocket</span><span className={'badge '+(t.services.gateway?'badge-success':'badge-danger')}>{t.services.gateway?'Actif':'Arrêté'}</span></div>
            <div className="service-line"><span>Agent ABESS</span><span className={'badge '+(t.services.reconciler?'badge-success':'badge-danger')}>{t.services.reconciler?'Actif':'Arrêté'}</span></div>
            <div className="service-line"><span>Dernière télémétrie</span><span>{fmtDateTime(t.observedAt)}</span></div>
          </div>}
          {!n.sshWsManaged&&<div className="empty-state" style={{padding:22}}><Activity size={22}/><strong>SSH-WSS non activé</strong><span>Installe l’agent sur le VPS puis renseigne son empreinte Ed25519.</span><button className="btn btn-primary" style={{marginTop:10}} onClick={()=>{setConfigure(n);setSni(n.sni||n.host)}}>Activer SSH-WSS</button></div>}
          {n.sshWsManaged&&!t&&<div className="empty-state"><Activity size={22}/><strong>Télémétrie en attente</strong><span>Elle apparaîtra après la prochaine synchronisation de l’agent mis à jour.</span></div>}
        </section>})}
    </div>
    {!nodes.length&&<div className="card empty-state"><Server size={26}/><strong>Aucun VPS enregistré</strong><span>Ajoute un nœud puis installe l’agent SSH-WSS.</span></div>}

    <div className="grid-equal">
      <section className="card card-pad"><div className="section-head"><div><h2>Santé du contrôle</h2><p>API, PostgreSQL et sauvegardes.</p></div><span className={'badge '+(!alertLabels.length?'badge-success':'badge-warning')}>{!alertLabels.length?'Sain':'Attention'}</span></div>
        <div className="service-line"><span>Uptime API</span><strong>{ops?.uptimeSeconds?uptime(ops.uptimeSeconds):'—'}</strong></div>
        <div className="service-line"><span>Mémoire processus</span><strong>{ops?.memoryBytes?humanBytes(ops.memoryBytes):'—'}</strong></div>
        <div className="service-line"><span>Sauvegarde hors site</span><strong>{ops?.backup?.offsite?'Confirmée':'Non confirmée'}</strong></div>
        {alertLabels.length>0&&<div className="alert-list" style={{marginTop:6}}>{alertLabels.map(l=><div className="alert-row" key={l}><span className="alert-dot" style={{background:'var(--warning)'}}/><div><p>{l}</p></div></div>)}</div>}
      </section>
      <section className="card card-pad"><div className="section-head"><div><h2>Journal infrastructure</h2><p>Dernières actions sensibles.</p></div></div>
        {!audit.some(a=>/NODE|BACKUP|RESTORE|ADMIN|SSH/.test(a.action))&&<div className="empty-state"><Activity size={20}/><strong>Aucune action récente</strong></div>}<div className="alert-list">{audit.filter(a=>/NODE|BACKUP|RESTORE|ADMIN|SSH/.test(a.action)).slice(0,7).map(a=><div className="alert-row" key={a.id}><span className="alert-dot" style={{background:'var(--info)'}}/><div><p>{a.action.replaceAll('_',' ')}</p><span>{fmtDateTime(a.timestamp)} · {String(a.details||'').slice(0,100)}</span></div></div>)}</div>
      </section>
    </div>

    {configure&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfigure(null)}}><form className="modal" onSubmit={e=>void activateNode(e)}>
      <div className="modal-head"><div><strong>Activer SSH-WSS · {configure.name}</strong><div className="card-subtitle">Associe l’identité SSH du VPS au domaine WSS.</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setConfigure(null)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block" style={{gridColumn:'1/-1'}}><span className="field-label">Empreinte Ed25519 SHA-256</span><input className="field" required placeholder="SHA256:…" value={fingerprint} onChange={e=>setFingerprint(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">SNI / domaine HTTPS</span><input className="field" required value={sni} onChange={e=>setSni(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Port WSS</span><input className="field" type="number" min="1" max="65535" value={port} onChange={e=>setPort(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Chemin WebSocket</span><input className="field" value={wsPath} onChange={e=>setWsPath(e.target.value)}/></label>
      </div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setConfigure(null)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Activer le nœud</button></div>
    </form></div>}

    {add&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAdd(false)}}><div className="modal">
      <div className="modal-head"><div><strong>Assistant d’ajout VPS</strong><div className="card-subtitle">Enregistre le nœud et génère sa clé agent une seule fois.</div></div><button className="icon-button ghost" aria-label="Fermer" onClick={()=>setAdd(false)}><X size={16}/></button></div>
      {!created?<form onSubmit={e=>void create(e)}><div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Nom du serveur</span><input className="field" required value={name} onChange={e=>setName(e.target.value)} placeholder="VPS France 02"/></label>
        <label className="field-block"><span className="field-label">IP ou nom DNS</span><input className="field" required value={host} onChange={e=>setHost(e.target.value)} placeholder="203.0.113.10"/></label>
        {error&&<p className="notice" role="alert">{error}</p>}
      </div><div className="modal-foot"><button className="btn" type="button" onClick={()=>setAdd(false)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Enregistrer</button></div></form>:
      <div className="modal-body stack">
        <div className="notice"><strong>Clé à conserver maintenant.</strong><br/>Elle ne sera pas affichée à nouveau. L’installation distante reste volontairement séparée : le panneau ne stocke jamais le mot de passe root du VPS.</div>
        <div className="detail-item"><label>ID du nœud</label><strong>{created.id}</strong></div>
        <div className="secret-value">{created.key}</div>
        <button className="btn" onClick={()=>void navigator.clipboard.writeText(created.key)}>Copier la clé agent</button>
        <p className="card-subtitle">Utilise cette clé avec l’installateur ABESS sur le VPS, puis active SSH-WSS avec son empreinte Ed25519. Cette séparation évite d’enregistrer des identifiants root dans le panneau.</p>
      </div>}
    </div></div>}
  </div>;
}

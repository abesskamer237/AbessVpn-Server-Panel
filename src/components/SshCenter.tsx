import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Copy,Download,Eye,EyeOff,Plus,Search,SlidersHorizontal,Trash2,X} from 'lucide-react';

type HistoryItem={at:string;type:string;note:string};
type Node={id:string;name:string;host:string;sni?:string;port:number;path:string;agentOnline:boolean};
type Account={
  id:string;username:string;label:string;nodeId?:string;resellerId?:string;resellerName?:string;managed:boolean;
  provisionState?:string;enabled:boolean;expiresAt:string;quotaBytes:number;usedBytes:number|null;online:number|null;
  maxConnections:number;trafficVerified:boolean;effectiveEnabled:boolean;createdAt:string;history?:HistoryItem[]
};
type Inventory={managedNodes:Node[];accounts:Account[];sshWsReady:boolean;resellers?:Array<{id:string;name:string}>};
type Config={username:string,password:string,path:string;sni:string;host:string;port:number;fingerprint:string;wire:string;transport:string;expiresAt:string;quotaGb:number;usedGb:number|null};
type Filter='all'|'active'|'expiring'|'quota'|'suspended'|'expired'|'error';
const gb=(n:number|null)=>n==null?'—':(n/1024**3).toFixed(n/1024**3>=100?0:1);
const pct=(a:Account)=>a.usedBytes==null?0:Math.min(100,Math.round(a.usedBytes/a.quotaBytes*100));
function state(a:Account){
  const exp=Date.parse(a.expiresAt),days=(exp-Date.now())/86400000,usage=pct(a);
  if(!a.enabled)return {label:'Suspendu',kind:'warning',key:'suspended'};
  if(a.provisionState==='error')return {label:'Erreur VPS',kind:'danger',key:'error'};
  if(exp<=Date.now())return {label:'Expiré',kind:'neutral',key:'expired'};
  if((a.usedBytes??0)>=a.quotaBytes)return {label:'Quota épuisé',kind:'danger',key:'quota'};
  if(days<=3)return {label:'Expire bientôt',kind:'warning',key:'expiring'};
  if(usage>=90)return {label:'Quota élevé',kind:'warning',key:'quota'};
  if(a.provisionState==='pending')return {label:'Provisionnement',kind:'info',key:'pending'};
  return {label:'Actif',kind:'success',key:'active'};
}

export function SshCenter({token,isAdmin=true}:{token:string,isAdmin?:boolean}){
  const [data,setData]=useState<Inventory|null>(null);
  const [search,setSearch]=useState('');const [filter,setFilter]=useState<Filter>('all');
  const [selected,setSelected]=useState<Account|null>(null);const [createOpen,setCreateOpen]=useState(false);
  const [nodeId,setNodeId]=useState('');const [label,setLabel]=useState('');const [days,setDays]=useState(30);const [quota,setQuota]=useState(10);const [connections,setConnections]=useState(1);const [resellerId,setResellerId]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [config,setConfig]=useState<Config|null>(null);const [showSecret,setShowSecret]=useState(false);
  const [renew,setRenew]=useState(false);const [renewGb,setRenewGb]=useState(10);const [renewDays,setRenewDays]=useState(30);
  const [editLabel,setEditLabel]=useState('');const [editConnections,setEditConnections]=useState(1);
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  async function request(uri:string,method='GET',body?:unknown,extra?:Record<string,string>){
    const r=await fetch('/api/v1/admin/ssh'+uri,{method,credentials:'same-origin',headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});
    const out=r.status===204?{}:await r.json().catch(()=>({}));if(!r.ok)throw Error(out.error||'Opération SSH-WSS refusée');return out;
  }
  async function refresh(){const x:Inventory=await request('');setData(x);setNodeId(v=>x.managedNodes.some(n=>n.id===v)?v:(x.managedNodes.find(n=>n.agentOnline)||x.managedNodes[0])?.id||'');
    if(selected){const fresh=x.accounts.find(a=>a.id===selected.id)||null;setSelected(fresh)}
  }
  useEffect(()=>{void refresh().catch(e=>setError(e.message));const t=setInterval(()=>void refresh().catch(()=>{}),10000);return()=>clearInterval(t)},[token]);
  useEffect(()=>{const fn=()=>setCreateOpen(true);window.addEventListener('abess:new-client',fn);return()=>window.removeEventListener('abess:new-client',fn)},[]);
  useEffect(()=>{if(selected){setEditLabel(selected.label);setEditConnections(selected.maxConnections);setConfig(null);setShowSecret(false)}},[selected?.id]);
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function create(e:FormEvent){e.preventDefault();await run(async()=>{const created=await request('/managed','POST',{nodeId,label:label.trim()||'Client SSH-WSS',days,quotaGb:quota,maxConnections:connections,...(isAdmin&&resellerId?{resellerId}:{})});setCreateOpen(false);setLabel('');setSelected(created)})}
  const managed=(data?.accounts||[]).filter(a=>a.managed);
  const filtered=useMemo(()=>managed.filter(a=>{
    const q=(a.label+' '+a.username+' '+(a.resellerName||'')).toLowerCase();if(!q.includes(search.toLowerCase()))return false;
    const s=state(a).key;if(filter==='all')return true;if(filter==='active')return s==='active';if(filter==='quota')return s==='quota';return s===filter;
  }),[data,search,filter]);
  const counts=useMemo(()=>Object.fromEntries(['active','expiring','quota','suspended','expired','error'].map(k=>[k,managed.filter(a=>state(a).key===k).length])),[data]);
  const node=data?.managedNodes.find(n=>n.id===nodeId);
  async function exportConfig(){if(!selected)return;setConfig(await request('/accounts/'+selected.id+'/config','POST',{transport:'wss'}))}
  function copyClientMessage(){
    if(!config)return;
    const text=['ABESS VPN — Configuration SSH-WSS','Utilisateur : '+config.username,'Mot de passe : '+config.password,'Serveur : '+config.sni,'Port : '+config.port,'SNI : '+config.sni,'WebSocket : '+config.path,'Empreinte : '+config.fingerprint,'Expiration : '+new Date(config.expiresAt).toLocaleDateString('fr-FR')].join('\n');
    void navigator.clipboard.writeText(text);
  }
  function downloadConfig(){if(!config)return;const u=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='abess-'+config.username+'.json';a.click();URL.revokeObjectURL(u)}
  const filters:Array<[Filter,string,number|undefined]>=[['all','Tous',managed.length],['active','Actifs',counts.active],['expiring','Expirent bientôt',counts.expiring],['quota','Quota',counts.quota],['suspended','Suspendus',counts.suspended],['expired','Expirés',counts.expired],['error','Erreurs',counts.error]];

  return <div className="stack">
    {error&&<div className="notice" role="alert">{error}</div>}
    <div className="card card-pad">
      <div className="toolbar">
        <div style={{position:'relative'}}><Search size={15} style={{position:'absolute',left:11,top:11,color:'var(--muted)'}}/><input className="search-input" style={{paddingLeft:34}} aria-label="Rechercher un client" type="search" placeholder="Nom, utilisateur ou revendeur…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="filter-pills">{filters.map(([id,label,count])=><button key={id} className={'filter-pill '+(filter===id?'active':'')} onClick={()=>setFilter(id)}>{label}{count!==undefined?' '+count:''}</button>)}</div>
        <button className="btn btn-primary" style={{marginLeft:'auto'}} onClick={()=>setCreateOpen(true)}><Plus size={15}/>Nouveau client</button>
      </div>
      <div className="data-table-wrap clients-desktop"><table className="data-table"><thead><tr><th>Client</th><th>État</th><th>Trafic / quota</th><th>Sessions</th><th>Expiration</th><th>Revendeur</th><th></th></tr></thead><tbody>
        {filtered.map(a=>{const s=state(a),usage=pct(a);return <tr key={a.id} onDoubleClick={()=>setSelected(a)}><td><div className="table-primary">{a.label}</div><div className="table-secondary">{a.username}</div></td><td><span className={'badge badge-'+s.kind}>{s.label}</span></td><td><div className={'progress '+(usage>=95?'danger':usage>=80?'warning':'')}><span style={{width:usage+'%'}}/></div><div className="progress-label">{gb(a.usedBytes)} / {gb(a.quotaBytes)} Go · {usage}%</div></td><td>{a.online??'—'} / {a.maxConnections}</td><td>{new Date(a.expiresAt).toLocaleDateString('fr-FR')}</td><td>{a.resellerName||'Administration'}</td><td><button className="btn btn-sm" onClick={()=>setSelected(a)}>Ouvrir</button></td></tr>})}
      </tbody></table></div>
      <div className="mobile-client-list">{filtered.map(a=>{const s=state(a);return <button key={a.id} className="mobile-client-card" style={{textAlign:'left',color:'inherit'}} onClick={()=>setSelected(a)}><div className="mobile-client-head"><div><strong>{a.label}</strong><div className="table-secondary">{a.username}</div></div><span className={'badge badge-'+s.kind}>{s.label}</span></div><div className="mobile-client-stats"><div className="mobile-client-stat"><span>Quota</span>{gb(a.usedBytes)} / {gb(a.quotaBytes)} Go</div><div className="mobile-client-stat"><span>Sessions</span>{a.online??'—'} / {a.maxConnections}</div><div className="mobile-client-stat"><span>Expiration</span>{new Date(a.expiresAt).toLocaleDateString('fr-FR')}</div><div className="mobile-client-stat"><span>Revendeur</span>{a.resellerName||'Admin'}</div></div></button>})}</div>
      {!filtered.length&&<div className="empty-state"><UsersIcon/><strong>Aucun client dans cette vue</strong><span>Modifiez les filtres ou créez une nouvelle licence SSH-WSS.</span></div>}
    </div>

    {createOpen&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><strong>Nouveau client SSH-WSS</strong><div className="table-secondary">Création guidée en une étape.</div></div><button className="icon-button" aria-label="Fermer" onClick={()=>setCreateOpen(false)}><X size={16}/></button></div>
      <form onSubmit={create}><div className="modal-body"><div className="form-grid">
        <label className="field-block"><span className="field-label">Nom du client</span><input className="field" required maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Ex. Jean Dupont"/></label>
        <label className="field-block"><span className="field-label">Serveur</span><select className="select" value={nodeId} onChange={e=>setNodeId(e.target.value)}><option value="">Choisir</option>{data?.managedNodes.map(n=><option key={n.id} value={n.id}>{n.name} · {n.agentOnline?'en ligne':'hors ligne'}</option>)}</select></label>
        <label className="field-block"><span className="field-label">Durée (jours)</span><input className="field" type="number" min={1} max={366} value={days} onChange={e=>setDays(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Quota (Go)</span><input className="field" type="number" min={0.01} max={100000} step={0.01} value={quota} onChange={e=>setQuota(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Sessions simultanées</span><input className="field" type="number" min={1} max={10} value={connections} onChange={e=>setConnections(Number(e.target.value))}/></label>
        {isAdmin&&<label className="field-block"><span className="field-label">Revendeur propriétaire</span><select className="select" value={resellerId} onChange={e=>setResellerId(e.target.value)}><option value="">Administration</option>{(data?.resellers||[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
      </div>{node&&!node.agentOnline&&<div className="notice" style={{marginTop:14}}>Le serveur sélectionné est hors ligne. La création restera bloquée tant que son agent ne répond pas.</div>}</div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreateOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={busy||!node?.agentOnline}>{busy?'Création…':'Créer la licence'}</button></div></form>
    </div></div>}

    {selected&&<><button className="drawer-backdrop" aria-label="Fermer la fiche client" onClick={()=>setSelected(null)}/><aside className="drawer"><div className="drawer-head"><div><div className="table-secondary">Fiche client</div><strong>{selected.label}</strong></div><button className="icon-button" onClick={()=>setSelected(null)}><X size={16}/></button></div><div className="drawer-body">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><span className={'badge badge-'+state(selected).kind}>{state(selected).label}</span><span className="table-secondary">{selected.username}</span></div>
      <div className="detail-grid"><div className="detail-item"><label>Expiration</label><strong>{new Date(selected.expiresAt).toLocaleString('fr-FR')}</strong></div><div className="detail-item"><label>Quota</label><strong>{gb(selected.usedBytes)} / {gb(selected.quotaBytes)} Go</strong></div><div className="detail-item"><label>Sessions</label><strong>{selected.online??'—'} / {selected.maxConnections}</strong></div><div className="detail-item"><label>Revendeur</label><strong>{selected.resellerName||'Administration'}</strong></div></div>
      <div className="card card-pad"><div className="section-head"><div><h2>Modifier</h2><p>Nom client et limite de sessions.</p></div><SlidersHorizontal size={16}/></div><div className="form-grid"><label className="field-block"><span className="field-label">Nom client</span><input className="field" value={editLabel} onChange={e=>setEditLabel(e.target.value)}/></label><label className="field-block"><span className="field-label">Sessions</span><input className="field" type="number" min={1} max={10} value={editConnections} onChange={e=>setEditConnections(Number(e.target.value))}/></label></div><button className="btn btn-sm" style={{marginTop:10}} disabled={busy} onClick={()=>void run(async()=>{await request('/accounts/'+selected.id,'PATCH',{label:editLabel,maxConnections:editConnections})})}>Enregistrer</button></div>
      <div className="row-actions"><button className="btn btn-primary" disabled={!selected.effectiveEnabled||busy} onClick={()=>void run(exportConfig)}>Afficher configuration</button><button className="btn" onClick={()=>setRenew(true)}>Renouveler</button><button className="btn" disabled={busy} onClick={()=>void run(async()=>{await request('/accounts/'+selected.id,'PATCH',{enabled:!selected.enabled})})}>{selected.enabled?'Suspendre':'Réactiver'}</button>{isAdmin&&<button className="btn btn-danger" disabled={busy} onClick={()=>{if(confirm('Supprimer définitivement cette licence ?'))void run(async()=>{await request('/accounts/'+selected.id,'DELETE');setSelected(null)})}}><Trash2 size={14}/>Supprimer</button>}</div>
      {config&&<div className="card card-pad"><div className="section-head"><div><h2>Configuration client</h2><p>Informations prêtes à copier ou envoyer.</p></div><button className="icon-button" onClick={()=>setShowSecret(v=>!v)}>{showSecret?<EyeOff size={15}/>:<Eye size={15}/>}</button></div><div className="detail-grid"><div className="detail-item"><label>Utilisateur</label><strong>{config.username}</strong></div><div className="detail-item"><label>Serveur</label><strong>{config.sni}</strong></div><div className="detail-item"><label>Port</label><strong>{config.port}</strong></div><div className="detail-item"><label>Transport</label><strong>SSH-WSS</strong></div><div className="detail-item" style={{gridColumn:'1/-1'}}><label>Chemin WebSocket</label><strong>{config.path}</strong></div><div className="detail-item" style={{gridColumn:'1/-1'}}><label>Empreinte Ed25519</label><strong>{config.fingerprint}</strong></div></div><div style={{marginTop:10}}><span className="field-label">Mot de passe</span><div className="secret-value">{showSecret?config.password:'••••••••••••••••••••••••'}</div></div><div className="row-actions" style={{marginTop:10}}><button className="btn btn-sm" onClick={()=>void navigator.clipboard.writeText(JSON.stringify(config,null,2))}><Copy size={14}/>Copier JSON</button><button className="btn btn-sm" onClick={copyClientMessage}><Copy size={14}/>Copier message client</button><button className="btn btn-sm" onClick={downloadConfig}><Download size={14}/>Télécharger</button></div></div>}
      <div className="card card-pad"><div className="section-head"><div><h2>Historique</h2><p>Événements de cette licence.</p></div></div><div className="alert-list">{(selected.history||[{at:selected.createdAt,type:'CREATED',note:'Compte créé.'}]).slice().reverse().map((h,i)=><div className="alert-row" key={i}><span className="alert-dot" style={{background:'var(--brand)'}}/><div><p>{h.note}</p><span>{new Date(h.at).toLocaleString('fr-FR')} · {h.type}</span></div></div>)}</div></div>
    </div></aside></>}

    {renew&&selected&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><strong>Renouveler {selected.label}</strong><button className="icon-button" onClick={()=>setRenew(false)}><X size={16}/></button></div><div className="modal-body form-grid"><label className="field-block"><span className="field-label">Go supplémentaires</span><input className="field" type="number" min={0.01} step={0.01} value={renewGb} onChange={e=>setRenewGb(Number(e.target.value))}/></label><label className="field-block"><span className="field-label">Jours supplémentaires</span><input className="field" type="number" min={1} max={366} value={renewDays} onChange={e=>setRenewDays(Number(e.target.value))}/></label></div><div className="modal-foot"><button className="btn" onClick={()=>setRenew(false)}>Annuler</button><button className="btn btn-primary" disabled={busy} onClick={()=>void run(async()=>{await request('/accounts/'+selected.id+'/renew','POST',{additionalGb:renewGb,days:renewDays},{'Idempotency-Key':crypto.randomUUID().replaceAll('-','')});setRenew(false)})}>Confirmer le renouvellement</button></div></div></div>}
  </div>;
}

function UsersIcon(){return <div style={{fontSize:28}}>◎</div>}

import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Copy,Download,Edit3,Eye,Plus,Printer,RefreshCw,Search,Trash2,Wifi,X} from 'lucide-react';
import type {AuditEvent,Reseller,Role,SshAccount,SshInventory} from '../panelTypes';
import {accountStatus,bytesToGb,csvDownload,fmtDate,fmtDateTime,percent} from '../panelTypes';

type Props={
  inventory:SshInventory|null;resellers:Reseller[];role:Role;audit:AuditEvent[];
  request:(url:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<any>;
  refresh:()=>Promise<void>;createSignal?:number;
};
type ExportData={
  format?:string;protocol?:string;username:string;password:string;path:string;sni:string;
  host:string;port:number;fingerprint:string;wire:string;transport:string;
  expiresAt?:string;quotaGb?:number;usedGb?:number|null;trafficVerified?:boolean;
};

const badge=(tone:string)=>'badge badge-'+tone;
const gb=(n:number|null|undefined)=>bytesToGb(n).toLocaleString('fr-FR',{maximumFractionDigits:2});

export function SshCenter({inventory,resellers,role,audit,request,refresh,createSignal}:Props){
  const accounts=(inventory?.accounts||[]).filter(a=>a.managed);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('all');
  const [createOpen,setCreateOpen]=useState(false);
  const [selectedId,setSelectedId]=useState('');
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [label,setLabel]=useState('');
  const [username,setUsername]=useState('abv_');
  const [password,setPassword]=useState('');
  const [days,setDays]=useState(30);
  const [quotaGb,setQuotaGb]=useState(10);
  const [maxConnections,setMaxConnections]=useState(1);
  const [nodeId,setNodeId]=useState('');
  const [resellerId,setResellerId]=useState('');
  const [renewGb,setRenewGb]=useState(5);
  const [renewDays,setRenewDays]=useState(30);
  const [editLabel,setEditLabel]=useState('');
  const [editConnections,setEditConnections]=useState(1);
  const [config,setConfig]=useState<ExportData|null>(null);
  const canOperate=role==='SUPER_ADMIN'||role==='ADMIN';

  useEffect(()=>{if(createSignal)setCreateOpen(true)},[createSignal]);
  useEffect(()=>{
    if(!inventory?.managedNodes?.length)return;
    setNodeId(current=>{
      if(inventory.managedNodes.some(n=>n.id===current&&n.agentOnline))return current;
      const counts=new Map<string,number>();
      for(const a of accounts)counts.set(a.nodeId,(counts.get(a.nodeId)||0)+1);
      return [...inventory.managedNodes].filter(n=>n.agentOnline).sort((a,b)=>(counts.get(a.id)||0)-(counts.get(b.id)||0))[0]?.id||inventory.managedNodes[0].id;
    });
  },[inventory?.managedNodes?.map(n=>n.id+String(n.agentOnline)).join('|'),accounts.length]);

  const selected=accounts.find(a=>a.id===selectedId)||null;
  useEffect(()=>{if(selected){setEditLabel(selected.label);setEditConnections(selected.maxConnections);setConfig(null)}},[selectedId]);

  const filtered=useMemo(()=>accounts.filter(a=>{
    const st=accountStatus(a).key;
    if(filter!=='all'&&st!==filter)return false;
    const q=search.trim().toLowerCase();
    return !q||[a.label,a.username,a.resellerName||'',a.connection?.host||''].join(' ').toLowerCase().includes(q);
  }).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),[accounts,filter,search]);

  const filters=[
    ['all','Tous',accounts.length],
    ['active','Actifs',accounts.filter(a=>accountStatus(a).key==='active').length],
    ['expiring','À renouveler',accounts.filter(a=>accountStatus(a).key==='expiring').length],
    ['quota','Quota épuisé',accounts.filter(a=>accountStatus(a).key==='quota').length],
    ['suspended','Suspendus',accounts.filter(a=>accountStatus(a).key==='suspended').length],
    ['error','Erreurs',accounts.filter(a=>accountStatus(a).key==='error').length],
  ] as const;

  async function run(work:()=>Promise<void>){
    setWorking(true);setError('');
    try{await work();await refresh()}catch(e){setError(e instanceof Error?e.message:'Opération impossible')}
    finally{setWorking(false)}
  }
  async function create(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      const result=await request('/api/v1/admin/ssh/managed','POST',{
        nodeId,label:label.trim(),username:username.trim().toLowerCase(),password,days,quotaGb,maxConnections,
        ...(canOperate&&resellerId?{resellerId}:{})
      });
      setSelectedId(result.id);setCreateOpen(false);setLabel('');setUsername('abv_');setPassword('');setConfig(null);
    });
  }
  async function exportConfig(){
    if(!selected)return;
    await run(async()=>{setConfig(await request('/api/v1/admin/ssh/accounts/'+selected.id+'/config','POST',{transport:'wss'}))});
  }
  function copyClientMessage(){
    if(!config)return;
    const msg=[
      'ABESS VPN — Configuration SSH-WSS',
      '',
      'Serveur : '+config.host,
      'Port : '+config.port,
      'SNI : '+config.sni,
      'Chemin WebSocket : '+config.path,
      'Utilisateur : '+config.username,
      'Mot de passe : '+config.password,
      'Empreinte SSH : '+config.fingerprint,
      config.expiresAt?'Expiration : '+new Date(config.expiresAt).toLocaleDateString('fr-FR'):'',
      config.quotaGb!==undefined?'Quota : '+config.quotaGb+' Go':'',
      '',
      'Transport : SSH via WebSocket sécurisé (WSS/TLS).',
      'Ne partagez pas ces identifiants avec une autre personne.'
    ].filter(Boolean).join('\\n');
    void navigator.clipboard.writeText(msg);
  }
  function saveConfig(){
    if(!config)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='abess-'+config.username+'.json';a.click();URL.revokeObjectURL(url);
  }
  const events=selected?[...audit.filter(e=>String(e.details||'').includes(selected.id)),
    {id:'created-'+selected.id,timestamp:selected.createdAt,action:'SSH_CREATED',details:'Licence créée'} as AuditEvent]
    .sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,10):[];

  return <div className="stack">
    <div className="page-header">
      <div><h1>Clients</h1><p>Licences SSH-WSS, quotas, sessions, expirations et identifiants.</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>window.print()}><Printer size={14}/>PDF</button>
        <button className="btn" onClick={()=>csvDownload('abess-clients.csv',[
          ['Client','Utilisateur','Revendeur','État','Quota Go','Utilisé Go','Sessions','Expiration','Création'],
          ...filtered.map(a=>[a.label,a.username,a.resellerName||'Administration',accountStatus(a).label,bytesToGb(a.quotaBytes),bytesToGb(a.usedBytes),String(a.online||0)+'/'+a.maxConnections,a.expiresAt,a.createdAt])
        ])}><Download size={14}/>CSV</button>
        <button className="btn btn-primary" onClick={()=>setCreateOpen(true)}><Plus size={15}/>Nouveau client</button>
      </div>
    </div>

    {error&&<p className="notice" role="alert">{error}</p>}
    <section className="card card-pad">
      <div className="toolbar">
        <div style={{position:'relative',flex:'0 1 320px'}}><Search size={14} style={{position:'absolute',left:11,top:12,color:'var(--muted)'}}/><input className="search-input" style={{paddingLeft:32,width:'100%'}} placeholder="Client, utilisateur, revendeur…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="filter-pills">{filters.map(([key,name,count])=><button key={key} className={'filter-pill '+(filter===key?'active':'')} onClick={()=>setFilter(key)}>{name} · {count}</button>)}</div>
        <button className="btn btn-sm" style={{marginLeft:'auto'}} onClick={()=>void refresh()}><RefreshCw size={13}/>Actualiser</button>
      </div>

      <div className="data-table-wrap clients-desktop"><table className="data-table"><thead><tr><th>Client</th><th>État</th><th>Quota</th><th>Sessions</th><th>Expiration</th><th>Revendeur</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map(a=>{const st=accountStatus(a),p=percent(a.usedBytes,a.quotaBytes);return <tr key={a.id}>
          <td><div className="table-primary">{a.label}</div><div className="table-secondary">{a.username}</div></td>
          <td><span className={badge(st.tone)}>{st.label}</span></td>
          <td><div>{gb(a.usedBytes)} / {gb(a.quotaBytes)} Go</div><div className={'progress '+(p>=100?'danger':p>=85?'warning':'')}><span style={{width:p+'%'}}/></div><div className="progress-label">{p}% consommé</div></td>
          <td><div className="table-primary">{a.online??'—'} / {a.maxConnections}</div><div className="table-secondary">sessions WSS</div></td>
          <td>{fmtDate(a.expiresAt)}<div className="table-secondary">créé {fmtDate(a.createdAt)}</div></td>
          <td>{a.resellerName||'Administration'}</td>
          <td><div className="row-actions"><button className="btn btn-sm" onClick={()=>setSelectedId(a.id)}><Eye size={13}/>Ouvrir</button>
            {a.provisionState==='error'?<button className="btn btn-sm btn-primary" disabled={working} onClick={()=>void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+a.id+'/retry','POST',{})})}>Réparer</button>:<button className="btn btn-sm" disabled={working} onClick={()=>void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+a.id,'PATCH',{enabled:!a.enabled})})}>{a.enabled?'Suspendre':'Réactiver'}</button>}</div></td>
        </tr>})}</tbody></table></div>

      <div className="mobile-client-list">{filtered.map(a=>{const st=accountStatus(a);return <article className="mobile-client-card" key={a.id} onClick={()=>setSelectedId(a.id)}>
        <div className="mobile-client-head"><div><strong>{a.label}</strong><div className="table-secondary">{a.username}</div></div><span className={badge(st.tone)}>{st.label}</span></div>
        <div className="mobile-client-stats"><div className="mobile-client-stat"><span>Quota</span>{gb(a.usedBytes)} / {gb(a.quotaBytes)} Go</div><div className="mobile-client-stat"><span>Sessions</span>{a.online??'—'} / {a.maxConnections}</div><div className="mobile-client-stat"><span>Expiration</span>{fmtDate(a.expiresAt)}</div><div className="mobile-client-stat"><span>Revendeur</span>{a.resellerName||'Admin'}</div></div>
      </article>})}</div>
      {!filtered.length&&<div className="empty-state"><Wifi size={25}/><strong>Aucun client pour ce filtre</strong><span>Crée une nouvelle licence ou modifie les filtres.</span></div>}
    </section>

    {createOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}><form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>Nouveau client SSH-WSS</strong><div className="card-subtitle">Le serveur le moins chargé est présélectionné automatiquement.</div></div><button type="button" className="icon-button" onClick={()=>setCreateOpen(false)}><X size={16}/></button></div>
      <div className="modal-body">
        <div style={{marginBottom:14}}><span className="field-label">Packs rapides</span><div className="filter-pills">
          {[
            ['Découverte',7,5,1],
            ['Standard',30,10,1],
            ['Duo',30,25,2],
            ['Premium',90,50,3]
          ].map(([name,d,q,c])=><button key={String(name)} type="button" className="filter-pill" onClick={()=>{setDays(Number(d));setQuotaGb(Number(q));setMaxConnections(Number(c))}}>{name} · {q} Go · {d} j · {c} session{Number(c)>1?'s':''}</button>)}
        </div></div>
        <div className="form-grid">
        <label className="field-block"><span className="field-label">Nom du client</span><input className="field" autoFocus required maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Ex. Jean Dupont"/></label>
        <label className="field-block"><span className="field-label">Nom d’utilisateur SSH</span><input className="field" required minLength={7} maxLength={32} pattern="abv_[a-z0-9][a-z0-9_-]{2,27}" autoComplete="off" value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="abv_jean237"/><span className="field-help">Obligatoire · commence par abv_ · lettres minuscules, chiffres, _ et -.</span></label>
        <label className="field-block"><span className="field-label">Mot de passe SSH</span><input className="field" type="password" required minLength={8} maxLength={96} pattern="[A-Za-z0-9@#$%&*+=._-]{8,96}" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="8 caractères minimum"/><span className="field-help">Obligatoire · 8 à 96 caractères.</span></label>
        <label className="field-block"><span className="field-label">Serveur</span><select className="select" required value={nodeId} onChange={e=>setNodeId(e.target.value)}>{inventory?.managedNodes.map(n=><option key={n.id} value={n.id} disabled={!n.agentOnline}>{n.name} · {n.agentOnline?'en ligne':'hors ligne'}</option>)}</select></label>
        <label className="field-block"><span className="field-label">Durée</span><select className="select" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>7 jours</option><option value={30}>30 jours</option><option value={60}>60 jours</option><option value={90}>90 jours</option><option value={180}>180 jours</option><option value={365}>365 jours</option></select></label>
        <label className="field-block"><span className="field-label">Quota (Go)</span><input className="field" type="number" min=".01" step=".01" required value={quotaGb} onChange={e=>setQuotaGb(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Sessions simultanées</span><input className="field" type="number" min="1" max="10" required value={maxConnections} onChange={e=>setMaxConnections(Number(e.target.value))}/></label>
        {canOperate&&<label className="field-block"><span className="field-label">Revendeur propriétaire</span><select className="select" value={resellerId} onChange={e=>setResellerId(e.target.value)}><option value="">Administration</option>{resellers.filter(r=>r.status==='active').map(r=><option key={r.id} value={r.id}>{r.name} · {r.credits} Go</option>)}</select></label>}
        </div>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreateOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={working||!inventory?.managedNodes.some(n=>n.id===nodeId&&n.agentOnline)}>{working?'Création…':'Créer la licence'}</button></div>
    </form></div>}

    {selected&&<><div className="drawer-backdrop" onClick={()=>setSelectedId('')}/><aside className="drawer">
      <div className="drawer-head"><div><strong>{selected.label}</strong><div className="card-subtitle">{selected.username}</div></div><button className="icon-button" onClick={()=>setSelectedId('')}><X size={16}/></button></div>
      <div className="drawer-body">
        <div style={{display:'flex',gap:7,flexWrap:'wrap'}}><span className={badge(accountStatus(selected).tone)}>{accountStatus(selected).label}</span><span className="badge badge-neutral">{selected.resellerName||'Administration'}</span></div>
        <div className="detail-grid">
          <div className="detail-item"><label>Quota</label><strong>{gb(selected.usedBytes)} / {gb(selected.quotaBytes)} Go</strong></div>
          <div className="detail-item"><label>Sessions</label><strong>{selected.online??'—'} / {selected.maxConnections}</strong></div>
          <div className="detail-item"><label>Expiration</label><strong>{fmtDate(selected.expiresAt)}</strong></div>
          <div className="detail-item"><label>Création</label><strong>{fmtDate(selected.createdAt)}</strong></div>
        </div>

        <section className="soft-surface" style={{padding:13}}><div className="section-head"><div><h2>Modifier</h2><p>Nom client et limite de sessions.</p></div><Edit3 size={15}/></div>
          <div className="form-grid"><label className="field-block"><span className="field-label">Nom</span><input className="field" value={editLabel} onChange={e=>setEditLabel(e.target.value)}/></label>
          <label className="field-block"><span className="field-label">Sessions</span><input className="field" type="number" min="1" max="10" value={editConnections} onChange={e=>setEditConnections(Number(e.target.value))}/></label></div>
          <button className="btn btn-sm" style={{marginTop:9}} disabled={working} onClick={()=>void run(async()=>request('/api/v1/admin/ssh/accounts/'+selected.id,'PATCH',{label:editLabel,maxConnections:editConnections}))}>Enregistrer</button>
        </section>

        <section className="soft-surface" style={{padding:13}}><div className="section-head"><div><h2>Renouvellement</h2><p>Ajoute quota et durée sans perdre l’historique.</p></div></div>
          <div className="form-grid"><label className="field-block"><span className="field-label">Go supplémentaires</span><input className="field" type="number" min=".01" step=".01" value={renewGb} onChange={e=>setRenewGb(Number(e.target.value))}/></label>
          <label className="field-block"><span className="field-label">Jours supplémentaires</span><input className="field" type="number" min="1" max="366" value={renewDays} onChange={e=>setRenewDays(Number(e.target.value))}/></label></div>
          <button className="btn btn-sm btn-primary" style={{marginTop:9}} disabled={working} onClick={()=>void run(async()=>request('/api/v1/admin/ssh/accounts/'+selected.id+'/renew','POST',{additionalGb:renewGb,days:renewDays},{'Idempotency-Key':crypto.randomUUID().replaceAll('-','')}))}>Confirmer le renouvellement</button>
        </section>

        <section className="soft-surface" style={{padding:13}}><div className="section-head"><div><h2>Configuration client</h2><p>Les secrets ne sont chargés qu’à la demande.</p></div></div>
          {!config?<button className="btn btn-primary" disabled={working||!selected.effectiveEnabled} onClick={()=>void exportConfig()}><Eye size={14}/>Afficher la configuration</button>:<div className="stack">
            <div className="detail-grid"><div className="detail-item"><label>Serveur</label><strong>{config.host}:{config.port}</strong></div><div className="detail-item"><label>SNI</label><strong>{config.sni}</strong></div><div className="detail-item"><label>Utilisateur</label><strong>{config.username}</strong></div><div className="detail-item"><label>Transport</label><strong>SSH · WSS/TLS</strong></div></div>
            <div><span className="field-label">Mot de passe</span><div className="secret-value">{config.password}</div></div>
            <div><span className="field-label">Chemin WebSocket personnel</span><div className="secret-value">{config.path}</div></div>
            <div><span className="field-label">Empreinte Ed25519</span><div className="secret-value">{config.fingerprint}</div></div>
            <div className="row-actions"><button className="btn btn-sm" onClick={()=>void navigator.clipboard.writeText(JSON.stringify(config,null,2))}><Copy size={13}/>Copier tout</button><button className="btn btn-sm" onClick={copyClientMessage}><Copy size={13}/>Message client</button><button className="btn btn-sm" onClick={saveConfig}><Download size={13}/>JSON</button><button className="btn btn-sm btn-ghost" onClick={()=>setConfig(null)}>Masquer</button></div>
          </div>}
        </section>

        <section className="soft-surface" style={{padding:13}}><div className="section-head"><div><h2>Historique</h2><p>Actions liées à cette licence.</p></div></div>
          <div className="alert-list">{events.map(e=><div className="alert-row" key={e.id}><span className="alert-dot" style={{background:'var(--brand)'}}/><div><p>{e.action.replaceAll('_',' ')}</p><span>{fmtDateTime(e.timestamp)} · {String(e.details||'').slice(0,110)}</span></div></div>)}</div>
        </section>

        <div className="row-actions">
          {selected.provisionState==='error'?<button className="btn btn-primary" disabled={working} onClick={()=>void run(async()=>request('/api/v1/admin/ssh/accounts/'+selected.id+'/retry','POST',{}))}>Réparer le compte</button>:<button className="btn" disabled={working} onClick={()=>void run(async()=>request('/api/v1/admin/ssh/accounts/'+selected.id,'PATCH',{enabled:!selected.enabled}))}>{selected.enabled?'Suspendre':'Réactiver'}</button>}
          {canOperate&&<button className="btn btn-danger" disabled={working} onClick={()=>{if(confirm('Supprimer définitivement cette licence SSH-WSS ?'))void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+selected.id,'DELETE');setSelectedId('')})}}><Trash2 size={13}/>Supprimer</button>}
        </div>
      </div>
    </aside></>}
  </div>;
}

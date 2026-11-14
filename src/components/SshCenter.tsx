import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {CalendarClock,Copy,Download,Eye,EyeOff,KeyRound,MoreHorizontal,Plus,Printer,RefreshCw,Search,ShieldAlert,Trash2,Users,Wifi,Wrench,X} from 'lucide-react';
import type {AuditEvent,Reseller,Role,SshAccount,SshInventory} from '../panelTypes';
import {accountStatus,bytesToGb,csvDownload,fmtDate,fmtDateTime,percent} from '../panelTypes';

type Props={
  inventory:SshInventory|null;resellers:Reseller[];role:Role;audit:AuditEvent[];
  request:(url:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<any>;
  refresh:()=>Promise<void>;createSignal?:number;openClient?:{id:string;n:number}|null;
};
type ExportData={
  format?:string;protocol?:string;username:string;password:string;path:string;sni:string;
  host:string;port:number;fingerprint:string;wire:string;transport:string;
  expiresAt?:string;quotaGb?:number;usedGb?:number|null;trafficVerified?:boolean;
};

const badge=(tone:string)=>'badge badge-'+tone;
const gb=(n:number|null|undefined)=>bytesToGb(n).toLocaleString('fr-FR',{maximumFractionDigits:2});

export function SshCenter({inventory,resellers,role,audit,request,refresh,createSignal,openClient}:Props){
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
  const [copied,setCopied]=useState('');
  useEffect(()=>{if(!copied)return;const t=window.setTimeout(()=>setCopied(''),2500);return()=>window.clearTimeout(t)},[copied]);
  const canOperate=role==='SUPER_ADMIN'||role==='ADMIN';

  useEffect(()=>{if(createSignal)setCreateOpen(true)},[createSignal]);
  useEffect(()=>{if(openClient)setSelectedId(openClient.id)},[openClient?.n]);
  const [showSecret,setShowSecret]=useState(false);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setCreateOpen(false);setSelectedId('')}};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[]);
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
    ].filter(Boolean).join('\n');
    void navigator.clipboard?.writeText(msg).then(()=>setCopied('Message client copié.'),()=>setError('Copie impossible : autorisez le presse-papiers.'));
  }
  function saveConfig(){
    if(!config)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='abess-'+config.username+'.json';a.click();URL.revokeObjectURL(url);
  }
  const events=selected?[...audit.filter(e=>String(e.details||'').includes(selected.id)),
    {id:'created-'+selected.id,timestamp:selected.createdAt,action:'SSH_CREATED',details:'Licence créée'} as AuditEvent]
    .sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,10):[];

  const nodeName=(id:string)=>inventory?.managedNodes.find(n=>n.id===id)?.name||'—';
  const totals={sessions:accounts.reduce((n,a)=>n+(a.online||0),0),quota:accounts.reduce((n,a)=>n+a.quotaBytes,0),used:accounts.reduce((n,a)=>n+(a.usedBytes||0),0)};
  const toggle=(a:SshAccount)=>void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+a.id,'PATCH',{enabled:!a.enabled})});
  const repair=(a:SshAccount)=>void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+a.id+'/retry','POST',{})});
  const onlineNodes=inventory?.managedNodes.filter(n=>n.agentOnline)||[];

  return <div className="stack">
    <div className="page-header">
      <div><h1>Clients</h1><p>Licences SSH-WSS, quotas, sessions et identifiants.</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>window.print()}><Printer size={14}/>PDF</button>
        <button className="btn" onClick={()=>csvDownload('abess-clients.csv',[
          ['Client','Utilisateur','Revendeur','État','Quota Go','Utilisé Go','Sessions','Expiration','Création'],
          ...filtered.map(a=>[a.label,a.username,a.resellerName||'Administration',accountStatus(a).label,bytesToGb(a.quotaBytes),bytesToGb(a.usedBytes),String(a.online||0)+'/'+a.maxConnections,a.expiresAt,a.createdAt])
        ])}><Download size={14}/>CSV</button>
        <button className="btn btn-primary" onClick={()=>setCreateOpen(true)}><Plus size={14}/>Nouveau client</button>
      </div>
    </div>

    {error&&<p className="notice" role="alert">{error}</p>}
    {copied&&<p className="notice notice-success" role="status">{copied}</p>}

    <div className="metric-grid">
      <div className="metric-card"><div className="metric-label"><Users size={13}/>Licences</div><div className="metric-value">{accounts.length}</div><div className="metric-foot">{filters[1][2]} actives</div></div>
      <div className="metric-card"><div className="metric-label"><CalendarClock size={13}/>À renouveler</div><div className="metric-value">{filters[2][2]}</div><div className="metric-foot">Sous 3 jours</div></div>
      <div className="metric-card"><div className="metric-label"><Wifi size={13}/>Sessions</div><div className="metric-value">{totals.sessions}</div><div className="metric-foot">Connexions WSS en cours</div></div>
      <div className="metric-card"><div className="metric-label"><ShieldAlert size={13}/>Problèmes</div><div className="metric-value">{filters[3][2]+filters[5][2]}</div><div className="metric-foot">Quota épuisé ou erreur VPS</div></div>
    </div>

    <section className="card">
      <div className="panel-head" style={{flexWrap:'wrap'}}>
        <div className="search-wrap"><Search size={14}/><input className="search-input" placeholder="Client, utilisateur, revendeur…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="filter-pills">{filters.map(([key,name,count])=><button key={key} className={'filter-pill '+(filter===key?'active':'')} onClick={()=>setFilter(key)}>{name} <span style={{opacity:.6}}>{count}</span></button>)}</div>
        <button className="icon-button ghost" style={{marginLeft:'auto'}} aria-label="Actualiser la liste" onClick={()=>void refresh()}><RefreshCw size={14}/></button>
      </div>
      <div className="clients-desktop" style={{overflow:'auto'}}><table className="data-table"><thead><tr><th>Client</th><th>État</th><th>Consommation</th><th>Sessions</th><th>Expiration</th><th>Revendeur</th><th style={{width:1}}></th></tr></thead>
        <tbody>{filtered.map(a=>{const st=accountStatus(a),p=percent(a.usedBytes,a.quotaBytes);return <tr key={a.id} className="clickable" onClick={()=>setSelectedId(a.id)}>
          <td><div style={{display:'flex',alignItems:'center',gap:9}}><div className="avatar" style={{width:26,height:26,fontSize:11}}>{a.label.slice(0,1).toUpperCase()}</div><div><div className="table-primary">{a.label}</div><div className="table-secondary mono">{a.username}</div></div></div></td>
          <td><span className={badge(st.tone)}>{st.label}</span></td>
          <td style={{minWidth:150}}><div className="num" style={{fontSize:12}}>{gb(a.usedBytes)} <span className="table-secondary">/ {gb(a.quotaBytes)} Go</span></div><div className={'progress '+(p>=100?'danger':p>=85?'warning':'')}><span style={{width:p+'%'}}/></div></td>
          <td className="num">{a.online??'—'} <span className="table-secondary">/ {a.maxConnections}</span></td>
          <td><div className="num">{fmtDate(a.expiresAt)}</div><div className="table-secondary">{nodeName(a.nodeId)}</div></td>
          <td className="table-secondary" style={{color:'var(--text-2)'}}>{a.resellerName||'Administration'}</td>
          <td onClick={e=>e.stopPropagation()}><div className="row-actions">
            {a.provisionState==='error'?<button className="btn btn-sm" disabled={working} onClick={()=>repair(a)}><Wrench size={12}/>Réparer</button>:<button className="btn btn-sm btn-ghost" disabled={working} onClick={()=>toggle(a)}>{a.enabled?'Suspendre':'Réactiver'}</button>}
            <button className="icon-button ghost" style={{width:27,height:27}} aria-label={'Ouvrir '+a.label} onClick={()=>setSelectedId(a.id)}><MoreHorizontal size={14}/></button>
          </div></td>
        </tr>})}</tbody></table></div>

      <div className="mobile-client-list" style={{padding:10}}>{filtered.map(a=>{const st=accountStatus(a);return <article className="mobile-client-card" key={a.id} onClick={()=>setSelectedId(a.id)}>
        <div className="mobile-client-head"><div><strong>{a.label}</strong><div className="table-secondary mono">{a.username}</div></div><span className={badge(st.tone)}>{st.label}</span></div>
        <div className="mobile-client-stats"><div className="mobile-client-stat"><span>Quota</span>{gb(a.usedBytes)} / {gb(a.quotaBytes)} Go</div><div className="mobile-client-stat"><span>Sessions</span>{a.online??'—'} / {a.maxConnections}</div><div className="mobile-client-stat"><span>Expiration</span>{fmtDate(a.expiresAt)}</div><div className="mobile-client-stat"><span>Revendeur</span>{a.resellerName||'Admin'}</div></div>
      </article>})}</div>
      {!filtered.length&&<div className="empty-state"><Wifi size={22}/><strong>Aucun client pour ce filtre</strong><span>Créez une licence ou modifiez les filtres.</span></div>}
    </section>

    {createOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}><form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>Nouveau client SSH-WSS</strong><div className="card-subtitle">Le serveur le moins chargé est présélectionné.</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setCreateOpen(false)}><X size={15}/></button></div>
      <div className="modal-body stack" style={{gap:14}}>
        <div><span className="field-label">Formule</span><div className="preset-grid">
          {([['Découverte',7,5,1],['Standard',30,10,1],['Duo',30,25,2],['Premium',90,50,3]] as const).map(([name,d,q,c])=><button key={name} type="button" className="preset" style={days===d&&quotaGb===q&&maxConnections===c?{borderColor:'var(--accent-line)',background:'var(--accent-soft)'}:undefined} onClick={()=>{setDays(d);setQuotaGb(q);setMaxConnections(c)}}><strong>{name}</strong><span>{q} Go · {d} j · {c} session{c>1?'s':''}</span></button>)}
        </div></div>
        <div className="form-grid">
          <label className="field-block"><span className="field-label">Nom du client</span><input className="field" autoFocus required maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Ex. Jean Dupont"/></label>
          <label className="field-block"><span className="field-label">Nom d’utilisateur SSH</span><input className="field mono" required minLength={7} maxLength={32} pattern="abv_[a-z0-9][a-z0-9_-]{2,27}" autoComplete="off" value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="abv_jean237"/><span className="field-help">Commence par abv_ · minuscules, chiffres, _ et -</span></label>
          <label className="field-block"><span className="field-label">Mot de passe SSH</span><input className="field mono" type="password" required minLength={8} maxLength={96} pattern="[A-Za-z0-9@#$%&*+=._-]{8,96}" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="8 caractères minimum"/></label>
          <label className="field-block"><span className="field-label">Serveur</span><select className="select" required value={nodeId} onChange={e=>setNodeId(e.target.value)}>{inventory?.managedNodes.map(n=><option key={n.id} value={n.id} disabled={!n.agentOnline}>{n.name} · {n.agentOnline?'en ligne':'hors ligne'}</option>)}</select>{!onlineNodes.length&&<span className="field-help" style={{color:'var(--warning)'}}>Aucun VPS en ligne pour le moment.</span>}</label>
          <label className="field-block"><span className="field-label">Durée</span><select className="select" value={days} onChange={e=>setDays(Number(e.target.value))}>{[7,30,60,90,180,365].map(d=><option key={d} value={d}>{d} jours</option>)}</select></label>
          <label className="field-block"><span className="field-label">Quota (Go)</span><input className="field num" type="number" min=".01" step=".01" required value={quotaGb} onChange={e=>setQuotaGb(Number(e.target.value))}/><span className="field-help">Débité du solde du revendeur propriétaire.</span></label>
          <label className="field-block"><span className="field-label">Sessions simultanées</span><input className="field num" type="number" min="1" max="10" required value={maxConnections} onChange={e=>setMaxConnections(Number(e.target.value))}/></label>
          {canOperate&&<label className="field-block"><span className="field-label">Revendeur propriétaire</span><select className="select" value={resellerId} onChange={e=>setResellerId(e.target.value)}><option value="">Administration</option>{resellers.filter(r=>r.status==='active').map(r=><option key={r.id} value={r.id}>{r.name} · {Number(r.credits||0).toFixed(2)} Go</option>)}</select></label>}
        </div>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreateOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={working||!inventory?.managedNodes.some(n=>n.id===nodeId&&n.agentOnline)}>{working?'Création…':'Créer la licence'}</button></div>
    </form></div>}

    {selected&&<><div className="drawer-backdrop" onClick={()=>setSelectedId('')}/><aside className="drawer" aria-label={'Fiche '+selected.label}>
      <div className="drawer-head"><div style={{display:'flex',alignItems:'center',gap:10}}><div className="avatar">{selected.label.slice(0,1).toUpperCase()}</div><div><strong>{selected.label}</strong><div className="card-subtitle mono">{selected.username}</div></div></div><button className="icon-button ghost" aria-label="Fermer" onClick={()=>setSelectedId('')}><X size={15}/></button></div>
      <div className="drawer-body">
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><span className={badge(accountStatus(selected).tone)}>{accountStatus(selected).label}</span><span className="badge badge-neutral">{selected.resellerName||'Administration'}</span><span className="badge badge-neutral plain">{nodeName(selected.nodeId)}</span></div>
        <div className="detail-grid">
          <div className="detail-item"><label>Consommation</label><strong className="num">{gb(selected.usedBytes)} / {gb(selected.quotaBytes)} Go</strong><div className="progress"><span style={{width:percent(selected.usedBytes,selected.quotaBytes)+'%'}}/></div></div>
          <div className="detail-item"><label>Sessions</label><strong className="num">{selected.online??'—'} / {selected.maxConnections}</strong></div>
          <div className="detail-item"><label>Expiration</label><strong>{fmtDate(selected.expiresAt)}</strong></div>
          <div className="detail-item"><label>Création</label><strong>{fmtDate(selected.createdAt)}</strong></div>
        </div>

        <section className="drawer-section"><div className="ds-head"><div><h2>Configuration client</h2><p>Les secrets sont chargés à la demande et audités.</p></div><KeyRound size={14} color="var(--muted)"/></div><div className="ds-body">
          {!config?<button className="btn btn-primary" style={{width:'100%'}} disabled={working||!selected.effectiveEnabled} onClick={()=>void exportConfig()}><Eye size={14}/>Afficher la configuration</button>:<div className="stack" style={{gap:8}}>
            <div className="detail-grid"><div className="detail-item"><label>Serveur</label><strong className="mono">{config.host}:{config.port}</strong></div><div className="detail-item"><label>SNI</label><strong className="mono">{config.sni}</strong></div><div className="detail-item"><label>Utilisateur</label><strong className="mono">{config.username}</strong></div><div className="detail-item"><label>Transport</label><strong>SSH · WSS/TLS</strong></div></div>
            <div><span className="field-label">Mot de passe</span><div className="secret-value" style={{display:'flex',justifyContent:'space-between',gap:8}}><span>{showSecret?config.password:'•'.repeat(Math.min(16,config.password.length))}</span><button className="icon-button ghost" style={{width:22,height:22}} aria-label={showSecret?'Masquer':'Afficher'} onClick={()=>setShowSecret(v=>!v)}>{showSecret?<EyeOff size={12}/>:<Eye size={12}/>}</button></div></div>
            <div><span className="field-label">Chemin WebSocket personnel</span><div className="secret-value">{config.path}</div></div>
            <div><span className="field-label">Empreinte Ed25519</span><div className="secret-value">{config.fingerprint}</div></div>
            <div className="row-actions"><button className="btn btn-sm btn-primary" onClick={copyClientMessage}><Copy size={12}/>Message client</button><button className="btn btn-sm" onClick={()=>void navigator.clipboard?.writeText(JSON.stringify(config,null,2)).then(()=>setCopied('Configuration copiée.'))}><Copy size={12}/>JSON</button><button className="btn btn-sm" onClick={saveConfig}><Download size={12}/>Fichier</button><button className="btn btn-sm btn-ghost" onClick={()=>{setConfig(null);setShowSecret(false)}}>Masquer</button></div>
          </div>}
        </div></section>

        <section className="drawer-section"><div className="ds-head"><div><h2>Renouvellement</h2><p>Ajoute quota et durée, sans perte d’historique.</p></div></div><div className="ds-body">
          <div className="form-grid"><label className="field-block"><span className="field-label">Go supplémentaires</span><input className="field num" type="number" min=".01" step=".01" value={renewGb} onChange={e=>setRenewGb(Number(e.target.value))}/></label>
          <label className="field-block"><span className="field-label">Jours supplémentaires</span><input className="field num" type="number" min="1" max="366" value={renewDays} onChange={e=>setRenewDays(Number(e.target.value))}/></label></div>
          <button className="btn btn-primary" style={{marginTop:10,width:'100%'}} disabled={working} onClick={()=>void run(async()=>request('/api/v1/admin/ssh/accounts/'+selected.id+'/renew','POST',{additionalGb:renewGb,days:renewDays},{'Idempotency-Key':crypto.randomUUID().replaceAll('-','')}))}>Renouveler · +{renewGb} Go, +{renewDays} j</button>
        </div></section>

        <section className="drawer-section"><div className="ds-head"><div><h2>Paramètres</h2><p>Nom affiché et limite de sessions.</p></div></div><div className="ds-body">
          <div className="form-grid"><label className="field-block"><span className="field-label">Nom</span><input className="field" value={editLabel} onChange={e=>setEditLabel(e.target.value)}/></label>
          <label className="field-block"><span className="field-label">Sessions</span><input className="field num" type="number" min="1" max="10" value={editConnections} onChange={e=>setEditConnections(Number(e.target.value))}/></label></div>
          <button className="btn btn-sm" style={{marginTop:10}} disabled={working} onClick={()=>void run(async()=>request('/api/v1/admin/ssh/accounts/'+selected.id,'PATCH',{label:editLabel,maxConnections:editConnections}))}>Enregistrer</button>
        </div></section>

        <section className="drawer-section"><div className="ds-head"><div><h2>Historique</h2><p>Actions liées à cette licence.</p></div></div><div className="ds-body" style={{paddingTop:2,paddingBottom:2}}>
          <div className="alert-list">{events.map(e=><div className="alert-row" key={e.id}><span className="alert-dot" style={{background:'var(--accent)'}}/><div><p>{e.action.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase())}</p><span>{fmtDateTime(e.timestamp)}</span></div></div>)}</div>
        </div></section>

        <div className="row-actions">
          {selected.provisionState==='error'?<button className="btn btn-primary" disabled={working} onClick={()=>repair(selected)}><Wrench size={13}/>Réparer le compte</button>:<button className="btn" disabled={working} onClick={()=>toggle(selected)}>{selected.enabled?'Suspendre':'Réactiver'}</button>}
          {canOperate&&<button className="btn btn-danger" style={{marginLeft:'auto'}} disabled={working} onClick={()=>{if(confirm('Supprimer définitivement cette licence SSH-WSS ?'))void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+selected.id,'DELETE');setSelectedId('')})}}><Trash2 size={13}/>Supprimer</button>}
        </div>
      </div>
    </aside></>}
  </div>;
}

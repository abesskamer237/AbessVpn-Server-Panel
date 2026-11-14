import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {ArrowRightLeft,Ban,CalendarClock,Check,Copy,Download,Eye,EyeOff,KeyRound,MessageCircle,MonitorSmartphone,MoreHorizontal,Pause,Play,Plus,Printer,RefreshCw,Search,ShieldAlert,Smartphone,Trash2,Users,Wand2,Wifi,Wrench,X} from 'lucide-react';
import type {AuditEvent,Reseller,Role,SshAccount,SshInventory,User} from '../panelTypes';
import {accountStatus,bytesToGb,csvDownload,fmtDate,fmtDateTime,percent} from '../panelTypes';

type Props={
  inventory:SshInventory|null;resellers:Reseller[];role:Role;audit:AuditEvent[];currentUser:User;
  request:(url:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<any>;
  refresh:()=>Promise<void>;createSignal?:number;openClient?:{id:string;n:number}|null;
};
type ExportData={
  format?:string;protocol?:string;username:string;password:string;path:string;sni:string;
  host:string;port:number;fingerprint:string;wire:string;transport:string;
  expiresAt?:string;quotaGb?:number;usedGb?:number|null;trafficVerified?:boolean;
};
type Device={deviceKey:string;usedBytes:number;upBytes:number;downBytes:number;firstSeenAt?:string;lastSeenAt?:string;activeSessions?:number;ip?:string;userAgent?:string;name?:string;brand?:string;blocked:boolean};
type DrawerTab='overview'|'config'|'devices'|'history';

const badge=(tone:string)=>'badge badge-'+tone;
const gb=(n:number|null|undefined)=>bytesToGb(n).toLocaleString('fr-FR',{maximumFractionDigits:2});
const PASSWORD_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%+=._-';
function generatePassword(length=14){
  const values=crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values,v=>PASSWORD_CHARS[v%PASSWORD_CHARS.length]).join('');
}
function suggestUsername(name:string,taken:Set<string>){
  const base=name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'').slice(0,18)||'client';
  let candidate='abv_'+base;let i=1;
  while(candidate.length<7||taken.has(candidate))candidate='abv_'+base+(++i);
  return candidate;
}
const daysLeft=(iso:string)=>Math.ceil((Date.parse(iso)-Date.now())/86400000);
const PACKS=[['Découverte',7,5,1],['Standard',30,10,1],['Duo',30,25,2],['Premium',90,50,3]] as const;
const RENEWALS=[[5,30],[10,30],[25,30],[50,90]] as const;
const SORTS={recent:'Plus récents',expiry:'Expiration proche',usage:'Consommation',name:'Nom (A→Z)'} as const;

export function SshCenter({inventory,resellers,role,audit,currentUser,request,refresh,createSignal,openClient}:Props){
  const accounts=(inventory?.accounts||[]).filter(a=>a.managed);
  const canOperate=role==='SUPER_ADMIN'||role==='ADMIN';
  const isReseller=role==='RESELLER';
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[ownerFilter,setOwnerFilter]=useState(''),[nodeFilter,setNodeFilter]=useState('');
  const [sort,setSort]=useState<keyof typeof SORTS>('recent');
  const [checked,setChecked]=useState<Set<string>>(new Set());
  const [createOpen,setCreateOpen]=useState(false),[selectedId,setSelectedId]=useState(''),[tab,setTab]=useState<DrawerTab>('overview');
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState('');
  const [label,setLabel]=useState(''),[username,setUsername]=useState('abv_'),[usernameTouched,setUsernameTouched]=useState(false),[password,setPassword]=useState(''),[showNewPassword,setShowNewPassword]=useState(false);
  const [days,setDays]=useState(30),[quotaGb,setQuotaGb]=useState(10),[maxConnections,setMaxConnections]=useState(1),[nodeId,setNodeId]=useState(''),[resellerId,setResellerId]=useState('');
  const [renewGb,setRenewGb]=useState(5),[renewDays,setRenewDays]=useState(30);
  const [editLabel,setEditLabel]=useState(''),[editConnections,setEditConnections]=useState(1),[newSshPassword,setNewSshPassword]=useState(''),[transferTo,setTransferTo]=useState('');
  const [config,setConfig]=useState<ExportData|null>(null),[showSecret,setShowSecret]=useState(false);
  const [devices,setDevices]=useState<Device[]|null>(null);
  const [bulk,setBulk]=useState<null|'renew'>(null);

  useEffect(()=>{if(!toast)return;const t=window.setTimeout(()=>setToast(''),2600);return()=>window.clearTimeout(t)},[toast]);
  useEffect(()=>{if(createSignal)setCreateOpen(true)},[createSignal]);
  useEffect(()=>{if(openClient){setSelectedId(openClient.id);setTab('overview')}},[openClient?.n]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setCreateOpen(false);setSelectedId('');setBulk(null)}};
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
  useEffect(()=>{
    if(!selected)return;
    setEditLabel(selected.label);setEditConnections(selected.maxConnections);setConfig(null);setShowSecret(false);setDevices(null);setNewSshPassword('');setTransferTo('');
  },[selectedId]);
  useEffect(()=>{
    if(!selected||tab!=='devices')return;
    request('/api/v1/admin/ssh/accounts/'+selected.id+'/devices').then(setDevices).catch(e=>setError(e instanceof Error?e.message:'Appareils indisponibles'));
  },[selectedId,tab]);

  const statusCount=(k:string)=>accounts.filter(a=>accountStatus(a).key===k).length;
  const filters=[['all','Tous',accounts.length],['active','Actifs',statusCount('active')],['expiring','À renouveler',statusCount('expiring')],['quota','Quota épuisé',statusCount('quota')],['expired','Expirés',statusCount('expired')],['suspended','Suspendus',statusCount('suspended')],['error','Erreurs',statusCount('error')]] as const;
  const owners=useMemo(()=>[...new Map(accounts.map(a=>[a.resellerId||'',a.resellerName||'Administration'])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'fr')),[accounts]);
  const filtered=useMemo(()=>accounts.filter(a=>{
    if(filter!=='all'&&accountStatus(a).key!==filter)return false;
    if(ownerFilter&&(a.resellerId||'')!==ownerFilter)return false;
    if(nodeFilter&&a.nodeId!==nodeFilter)return false;
    const q=search.trim().toLowerCase();
    return !q||[a.label,a.username,a.resellerName||''].join(' ').toLowerCase().includes(q);
  }).sort((a,b)=>sort==='expiry'?Date.parse(a.expiresAt)-Date.parse(b.expiresAt):sort==='usage'?percent(b.usedBytes,b.quotaBytes)-percent(a.usedBytes,a.quotaBytes):sort==='name'?a.label.localeCompare(b.label,'fr'):Date.parse(b.createdAt)-Date.parse(a.createdAt)),[accounts,filter,search,ownerFilter,nodeFilter,sort]);
  const checkedAccounts=accounts.filter(a=>checked.has(a.id));
  const allChecked=filtered.length>0&&filtered.every(a=>checked.has(a.id));

  async function run(work:()=>Promise<void|string>){
    setWorking(true);setError('');
    try{const msg=await work();await refresh();if(typeof msg==='string')setToast(msg)}catch(e){setError(e instanceof Error?e.message:'Opération impossible')}
    finally{setWorking(false)}
  }
  const patch=(a:SshAccount,body:Record<string,unknown>)=>request('/api/v1/admin/ssh/accounts/'+a.id,'PATCH',body);
  const renew=(a:SshAccount,additionalGb:number,d:number)=>request('/api/v1/admin/ssh/accounts/'+a.id+'/renew','POST',{additionalGb,days:d},{'Idempotency-Key':crypto.randomUUID().replaceAll('-','')});
  async function create(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      const result=await request('/api/v1/admin/ssh/managed','POST',{
        nodeId,label:label.trim(),username:username.trim().toLowerCase(),password,days,quotaGb,maxConnections,
        ...(canOperate&&resellerId?{resellerId}:{})
      });
      setSelectedId(result.id);setTab('config');setCreateOpen(false);setLabel('');setUsername('abv_');setUsernameTouched(false);setPassword('');setConfig(null);
      return 'Licence créée. Le VPS applique le compte sous quelques secondes.';
    });
  }
  async function exportConfig(){
    if(!selected)return;
    await run(async()=>{setConfig(await request('/api/v1/admin/ssh/accounts/'+selected.id+'/config','POST',{transport:'wss'}))});
  }
  const clientMessage=(c:ExportData)=>[
    'ABESS VPN — Configuration SSH-WSS','',
    'Serveur : '+c.host,'Port : '+c.port,'SNI : '+c.sni,'Chemin WebSocket : '+c.path,
    'Utilisateur : '+c.username,'Mot de passe : '+c.password,'Empreinte SSH : '+c.fingerprint,
    c.expiresAt?'Expiration : '+new Date(c.expiresAt).toLocaleDateString('fr-FR'):'',
    c.quotaGb!==undefined?'Quota : '+Number(c.quotaGb).toLocaleString('fr-FR',{maximumFractionDigits:2})+' Go':'','',
    'Transport : SSH via WebSocket sécurisé (WSS/TLS).','Ne partagez pas ces identifiants avec une autre personne.'
  ].filter(Boolean).join('\n');
  const copy=(text:string,msg:string)=>void navigator.clipboard?.writeText(text).then(()=>setToast(msg),()=>setError('Copie impossible : autorisez le presse-papiers.'));
  function saveConfig(){
    if(!config)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='abess-'+config.username+'.json';a.click();URL.revokeObjectURL(url);
  }
  async function bulkToggle(enabled:boolean){
    const targets=checkedAccounts.filter(a=>a.enabled!==enabled&&a.provisionState!=='error');
    await run(async()=>{
      let ok=0;const failed:string[]=[];
      for(const a of targets){try{await patch(a,{enabled});ok++}catch{failed.push(a.label)}}
      setChecked(new Set());
      if(failed.length)throw new Error(`${ok} client(s) mis à jour ; échec pour : ${failed.slice(0,5).join(', ')}${failed.length>5?'…':''}`);
      return `${ok} client(s) ${enabled?'réactivé(s)':'suspendu(s)'}.`;
    });
  }
  async function bulkRenew(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      let ok=0;const failed:string[]=[];
      for(const a of checkedAccounts){try{await renew(a,renewGb,renewDays);ok++}catch{failed.push(a.label)}}
      setChecked(new Set());setBulk(null);
      if(failed.length)throw new Error(`${ok} renouvelé(s) ; échec (solde ?) pour : ${failed.slice(0,5).join(', ')}${failed.length>5?'…':''}`);
      return `${ok} client(s) renouvelé(s) : +${renewGb} Go, +${renewDays} jours.`;
    });
  }
  const exportRows=(rows:SshAccount[])=>csvDownload('abess-clients.csv',[
    ['Client','Utilisateur','Revendeur','Serveur','État','Quota Go','Utilisé Go','Sessions','Expiration','Création'],
    ...rows.map(a=>[a.label,a.username,a.resellerName||'Administration',nodeName(a.nodeId),accountStatus(a).label,bytesToGb(a.quotaBytes),bytesToGb(a.usedBytes),String(a.online||0)+'/'+a.maxConnections,a.expiresAt,a.createdAt])
  ]);
  const events=selected?[...audit.filter(e=>String(e.details||'').includes(selected.id)),
    {id:'created-'+selected.id,timestamp:selected.createdAt,action:'SSH_CREATED',details:'Licence créée'} as AuditEvent]
    .sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,30):[];
  const nodeName=(id:string)=>inventory?.managedNodes.find(n=>n.id===id)?.name||'—';
  const totals={sessions:accounts.reduce((n,a)=>n+(a.online||0),0)};
  const toggle=(a:SshAccount)=>void run(async()=>{await patch(a,{enabled:!a.enabled});return a.enabled?'Client suspendu.':'Client réactivé.'});
  const repair=(a:SshAccount)=>void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+a.id+'/retry','POST',{});return 'Réparation demandée au VPS.'});
  const onlineNodes=inventory?.managedNodes.filter(n=>n.agentOnline)||[];
  const takenUsernames=useMemo(()=>new Set(accounts.map(a=>a.username)),[accounts]);
  const payerCredits=isReseller?Number(currentUser.credits||0):Number(resellers.find(r=>r.id===resellerId)?.credits??NaN);
  const showsBalance=isReseller||(canOperate&&!!resellerId);
  const expiryHint=(a:SshAccount)=>{const d=daysLeft(a.expiresAt);return d<0?'expiré':d===0?'aujourd’hui':d<=7?'J-'+d:''};

  return <div className="stack">
    <div className="page-header">
      <div><h1>Clients</h1><p>{isReseller?'Vos licences SSH-WSS : création, renouvellement, appareils et partage des accès.':'Licences SSH-WSS, quotas, sessions, appareils et identifiants.'}</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>window.print()}><Printer size={14}/>PDF</button>
        <button className="btn" onClick={()=>exportRows(filtered)}><Download size={14}/>CSV</button>
        <button className="btn btn-primary" onClick={()=>setCreateOpen(true)}><Plus size={14}/>Nouveau client</button>
      </div>
    </div>

    {error&&<p className="notice" role="alert">{error}</p>}
    {toast&&<div className="toast" role="status"><Check size={14}/>{toast}</div>}

    <div className="metric-grid">
      <div className="metric-card"><div className="metric-label"><Users size={13}/>Licences</div><div className="metric-value">{accounts.length}</div><div className="metric-foot">{statusCount('active')} actives</div></div>
      <div className="metric-card"><div className="metric-label"><CalendarClock size={13}/>À renouveler</div><div className="metric-value">{statusCount('expiring')}</div><div className="metric-foot">{statusCount('expired')} expirée(s)</div></div>
      <div className="metric-card"><div className="metric-label"><Wifi size={13}/>Sessions</div><div className="metric-value">{totals.sessions}</div><div className="metric-foot">Connexions WSS en cours</div></div>
      {isReseller?<div className="metric-card"><div className="metric-label"><ShieldAlert size={13}/>Votre solde</div><div className="metric-value">{Number(currentUser.credits||0).toFixed(2)} Go</div><div className="metric-foot">Débité à chaque création ou renouvellement</div></div>
        :<div className="metric-card"><div className="metric-label"><ShieldAlert size={13}/>Problèmes</div><div className="metric-value">{statusCount('quota')+statusCount('error')}</div><div className="metric-foot">Quota épuisé ou erreur VPS</div></div>}
    </div>

    <section className="card">
      <div className="panel-head" style={{flexWrap:'wrap'}}>
        <div className="search-wrap"><Search size={14}/><input className="search-input" placeholder="Client, utilisateur, revendeur…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="filter-pills">{filters.map(([key,name,count])=><button key={key} className={'filter-pill '+(filter===key?'active':'')} onClick={()=>setFilter(key)}>{name} <span style={{opacity:.6}}>{count}</span></button>)}</div>
        <div className="row-actions" style={{marginLeft:'auto'}}>
          {owners.length>1&&<select className="select" style={{width:'auto'}} aria-label="Filtrer par revendeur" value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)}><option value="">Tous les revendeurs</option>{owners.map(([id,name])=><option key={id||'admin'} value={id}>{name}</option>)}</select>}
          {(inventory?.managedNodes.length||0)>1&&<select className="select" style={{width:'auto'}} aria-label="Filtrer par serveur" value={nodeFilter} onChange={e=>setNodeFilter(e.target.value)}><option value="">Tous les serveurs</option>{inventory!.managedNodes.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select>}
          <select className="select" style={{width:'auto'}} aria-label="Trier" value={sort} onChange={e=>setSort(e.target.value as keyof typeof SORTS)}>{Object.entries(SORTS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
          <button className="icon-button ghost" aria-label="Actualiser la liste" onClick={()=>void refresh()}><RefreshCw size={14}/></button>
        </div>
      </div>

      {checked.size>0&&<div className="bulk-bar">
        <strong>{checked.size} sélectionné(s)</strong>
        <button className="btn btn-sm" disabled={working} onClick={()=>setBulk('renew')}><CalendarClock size={12}/>Renouveler</button>
        <button className="btn btn-sm" disabled={working} onClick={()=>void bulkToggle(false)}><Pause size={12}/>Suspendre</button>
        <button className="btn btn-sm" disabled={working} onClick={()=>void bulkToggle(true)}><Play size={12}/>Réactiver</button>
        <button className="btn btn-sm" onClick={()=>exportRows(checkedAccounts)}><Download size={12}/>Exporter</button>
        <button className="btn btn-sm btn-ghost" style={{marginLeft:'auto'}} onClick={()=>setChecked(new Set())}>Annuler la sélection</button>
      </div>}

      <div className="clients-desktop" style={{overflow:'auto'}}><table className="data-table"><thead><tr>
        <th style={{width:1}}><input type="checkbox" aria-label="Tout sélectionner" checked={allChecked} onChange={()=>setChecked(allChecked?new Set():new Set(filtered.map(a=>a.id)))}/></th>
        <th>Client</th><th>État</th><th>Consommation</th><th>Sessions</th><th>Expiration</th><th>Revendeur</th><th style={{width:1}}></th></tr></thead>
        <tbody>{filtered.map(a=>{const st=accountStatus(a),p=percent(a.usedBytes,a.quotaBytes),hint=expiryHint(a);return <tr key={a.id} className={'clickable'+(checked.has(a.id)?' selected':'')} onClick={()=>{setSelectedId(a.id);setTab('overview')}}>
          <td onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={'Sélectionner '+a.label} checked={checked.has(a.id)} onChange={()=>setChecked(v=>{const n=new Set(v);if(n.has(a.id))n.delete(a.id);else n.add(a.id);return n})}/></td>
          <td><div style={{display:'flex',alignItems:'center',gap:9}}><div className="avatar" style={{width:26,height:26,fontSize:11}}>{a.label.slice(0,1).toUpperCase()}</div><div><div className="table-primary">{a.label}</div><div className="table-secondary mono">{a.username}</div></div></div></td>
          <td><span className={badge(st.tone)}>{st.label}</span></td>
          <td style={{minWidth:150}}><div className="num" style={{fontSize:12}}>{gb(a.usedBytes)} <span className="table-secondary">/ {gb(a.quotaBytes)} Go</span></div><div className={'progress '+(p>=100?'danger':p>=85?'warning':'')}><span style={{width:p+'%'}}/></div></td>
          <td className="num">{a.online??'—'} <span className="table-secondary">/ {a.maxConnections}</span></td>
          <td><div className="num">{fmtDate(a.expiresAt)}{hint&&<span className={'badge plain '+(hint==='expiré'?'badge-neutral':'badge-warning')} style={{marginLeft:6,height:18}}>{hint}</span>}</div><div className="table-secondary">{nodeName(a.nodeId)}</div></td>
          <td className="table-secondary" style={{color:'var(--text-2)'}}>{a.resellerName||'Administration'}</td>
          <td onClick={e=>e.stopPropagation()}><div className="row-actions">
            {a.provisionState==='error'?<button className="btn btn-sm" disabled={working} onClick={()=>repair(a)}><Wrench size={12}/>Réparer</button>
              :<button className="btn btn-sm btn-ghost" disabled={working} onClick={()=>{setSelectedId(a.id);setTab('overview')}}><CalendarClock size={12}/>Renouveler</button>}
            <button className="icon-button ghost" style={{width:27,height:27}} title={a.enabled?'Suspendre':'Réactiver'} aria-label={(a.enabled?'Suspendre ':'Réactiver ')+a.label} disabled={working||a.provisionState==='error'} onClick={()=>toggle(a)}>{a.enabled?<Pause size={13}/>:<Play size={13}/>}</button>
            <button className="icon-button ghost" style={{width:27,height:27}} aria-label={'Ouvrir '+a.label} onClick={()=>{setSelectedId(a.id);setTab('overview')}}><MoreHorizontal size={14}/></button>
          </div></td>
        </tr>})}</tbody></table></div>

      <div className="mobile-client-list" style={{padding:10}}>{filtered.map(a=>{const st=accountStatus(a);return <article className="mobile-client-card" key={a.id} onClick={()=>{setSelectedId(a.id);setTab('overview')}}>
        <div className="mobile-client-head"><div><strong>{a.label}</strong><div className="table-secondary mono">{a.username}</div></div><span className={badge(st.tone)}>{st.label}</span></div>
        <div className="mobile-client-stats"><div className="mobile-client-stat"><span>Quota</span>{gb(a.usedBytes)} / {gb(a.quotaBytes)} Go</div><div className="mobile-client-stat"><span>Sessions</span>{a.online??'—'} / {a.maxConnections}</div><div className="mobile-client-stat"><span>Expiration</span>{fmtDate(a.expiresAt)}</div><div className="mobile-client-stat"><span>Revendeur</span>{a.resellerName||'Admin'}</div></div>
      </article>})}</div>
      {!filtered.length&&<div className="empty-state"><Wifi size={22}/><strong>Aucun client pour ce filtre</strong><span>Créez une licence ou modifiez les filtres.</span></div>}
    </section>

    {bulk==='renew'&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setBulk(null)}}><form className="modal" style={{width:'min(460px,100%)'}} onSubmit={e=>void bulkRenew(e)}>
      <div className="modal-head"><div><strong>Renouveler {checkedAccounts.length} client(s)</strong><div className="card-subtitle">Chaque licence reçoit le même ajout.</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setBulk(null)}><X size={15}/></button></div>
      <div className="modal-body stack">
        <div className="preset-grid">{RENEWALS.map(([g,d])=><button key={g+'-'+d} type="button" className={'preset'+(renewGb===g&&renewDays===d?' active':'')} onClick={()=>{setRenewGb(g);setRenewDays(d)}}><strong>+{g} Go</strong><span>+{d} jours</span></button>)}</div>
        <div className="form-grid"><label className="field-block"><span className="field-label">Go par client</span><input className="field num" type="number" min=".01" step=".01" value={renewGb} onChange={e=>setRenewGb(Number(e.target.value))}/></label>
          <label className="field-block"><span className="field-label">Jours par client</span><input className="field num" type="number" min="1" max="366" value={renewDays} onChange={e=>setRenewDays(Number(e.target.value))}/></label></div>
        <div className="detail-grid"><div className="detail-item"><label>Total débité</label><strong className="num">{(renewGb*checkedAccounts.length).toFixed(2)} Go</strong></div>
          <div className="detail-item"><label>{isReseller?'Votre solde après':'Débité aux'}</label><strong className="num">{isReseller?(Number(currentUser.credits||0)-renewGb*checkedAccounts.length).toFixed(2)+' Go':'revendeurs propriétaires'}</strong></div></div>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setBulk(null)}>Annuler</button><button className="btn btn-primary" disabled={working||(isReseller&&renewGb*checkedAccounts.length>Number(currentUser.credits||0))}>Renouveler</button></div>
    </form></div>}

    {createOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}><form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>Nouveau client SSH-WSS</strong><div className="card-subtitle">Le serveur le moins chargé est présélectionné.</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setCreateOpen(false)}><X size={15}/></button></div>
      <div className="modal-body stack" style={{gap:14}}>
        <div><span className="field-label">Formule</span><div className="preset-grid">
          {PACKS.map(([name,d,q,c])=><button key={name} type="button" className={'preset'+(days===d&&quotaGb===q&&maxConnections===c?' active':'')} onClick={()=>{setDays(d);setQuotaGb(q);setMaxConnections(c)}}><strong>{name}</strong><span>{q} Go · {d} j · {c} session{c>1?'s':''}</span></button>)}
        </div></div>
        <div className="form-grid">
          <label className="field-block"><span className="field-label">Nom du client</span><input className="field" autoFocus required maxLength={80} value={label} onChange={e=>{setLabel(e.target.value);if(!usernameTouched)setUsername(suggestUsername(e.target.value,takenUsernames))}} placeholder="Ex. Jean Dupont"/></label>
          <label className="field-block"><span className="field-label">Nom d’utilisateur SSH</span><input className="field mono" required minLength={7} maxLength={32} pattern="abv_[a-z0-9][a-z0-9_-]{2,27}" autoComplete="off" value={username} onChange={e=>{setUsernameTouched(true);setUsername(e.target.value.toLowerCase())}} placeholder="abv_jean237"/><span className="field-help">{takenUsernames.has(username)?<span style={{color:'var(--danger)'}}>Déjà utilisé.</span>:'Proposé automatiquement · commence par abv_'}</span></label>
          <label className="field-block"><span className="field-label">Mot de passe SSH</span>
            <div className="input-group"><input className="field mono" type={showNewPassword?'text':'password'} required minLength={8} maxLength={96} pattern="[A-Za-z0-9@#$%&*+=._\-]{8,96}" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="8 caractères minimum"/>
              <button type="button" className="icon-button" title="Afficher" aria-label="Afficher le mot de passe SSH" onClick={()=>setShowNewPassword(v=>!v)}>{showNewPassword?<EyeOff size={14}/>:<Eye size={14}/>}</button>
              <button type="button" className="icon-button" title="Générer" aria-label="Générer un mot de passe" onClick={()=>{setPassword(generatePassword());setShowNewPassword(true)}}><Wand2 size={14}/></button></div></label>
          <label className="field-block"><span className="field-label">Serveur</span><select className="select" required value={nodeId} onChange={e=>setNodeId(e.target.value)}>{inventory?.managedNodes.map(n=><option key={n.id} value={n.id} disabled={!n.agentOnline}>{n.name} · {n.agentOnline?'en ligne':'hors ligne'}</option>)}</select>{!onlineNodes.length&&<span className="field-help" style={{color:'var(--warning)'}}>Aucun VPS en ligne pour le moment.</span>}</label>
          <label className="field-block"><span className="field-label">Durée</span><select className="select" value={days} onChange={e=>setDays(Number(e.target.value))}>{[7,14,30,60,90,180,365].map(d=><option key={d} value={d}>{d} jours</option>)}</select></label>
          <label className="field-block"><span className="field-label">Quota (Go)</span><input className="field num" type="number" min=".01" step=".01" required value={quotaGb} onChange={e=>setQuotaGb(Number(e.target.value))}/></label>
          <label className="field-block"><span className="field-label">Sessions simultanées</span><input className="field num" type="number" min="1" max="10" required value={maxConnections} onChange={e=>setMaxConnections(Number(e.target.value))}/></label>
          {canOperate&&<label className="field-block"><span className="field-label">Revendeur propriétaire</span><select className="select" value={resellerId} onChange={e=>setResellerId(e.target.value)}><option value="">Administration</option>{resellers.filter(r=>r.status==='active').map(r=><option key={r.id} value={r.id}>{r.name} · {Number(r.credits||0).toFixed(2)} Go</option>)}</select></label>}
        </div>
        {showsBalance&&<div className="detail-grid">
          <div className="detail-item"><label>Coût de la licence</label><strong className="num">{quotaGb.toFixed(2)} Go</strong></div>
          <div className="detail-item"><label>Solde après création</label><strong className="num" style={{color:payerCredits-quotaGb<0?'var(--danger)':undefined}}>{(payerCredits-quotaGb).toFixed(2)} Go</strong></div>
        </div>}
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreateOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={working||!inventory?.managedNodes.some(n=>n.id===nodeId&&n.agentOnline)||(showsBalance&&payerCredits<quotaGb)||takenUsernames.has(username)}>{working?'Création…':'Créer la licence'}</button></div>
    </form></div>}

    {selected&&<><div className="drawer-backdrop" onClick={()=>setSelectedId('')}/><aside className="drawer" aria-label={'Fiche '+selected.label}>
      <div className="drawer-head"><div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}><div className="avatar">{selected.label.slice(0,1).toUpperCase()}</div><div style={{minWidth:0}}><strong>{selected.label}</strong><div className="card-subtitle mono">{selected.username}</div></div></div><button className="icon-button ghost" aria-label="Fermer" onClick={()=>setSelectedId('')}><X size={15}/></button></div>
      <div className="drawer-tabs">{([['overview','Aperçu'],['config','Configuration'],['devices','Appareils'],['history','Historique']] as [DrawerTab,string][]).map(([k,v])=><button key={k} className={'drawer-tab'+(tab===k?' active':'')} onClick={()=>setTab(k)}>{v}</button>)}</div>
      <div className="drawer-body">
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><span className={badge(accountStatus(selected).tone)}>{accountStatus(selected).label}</span><span className="badge badge-neutral">{selected.resellerName||'Administration'}</span><span className="badge badge-neutral plain">{nodeName(selected.nodeId)}</span></div>

        {tab==='overview'&&<>
          <div className="detail-grid">
            <div className="detail-item"><label>Consommation</label><strong className="num">{gb(selected.usedBytes)} / {gb(selected.quotaBytes)} Go</strong><div className="progress"><span style={{width:percent(selected.usedBytes,selected.quotaBytes)+'%'}}/></div></div>
            <div className="detail-item"><label>Sessions</label><strong className="num">{selected.online??'—'} / {selected.maxConnections}</strong></div>
            <div className="detail-item"><label>Expiration</label><strong>{fmtDate(selected.expiresAt)} {expiryHint(selected)&&<span className="table-secondary">({expiryHint(selected)})</span>}</strong></div>
            <div className="detail-item"><label>Création</label><strong>{fmtDate(selected.createdAt)}</strong></div>
          </div>

          <section className="drawer-section"><div className="ds-head"><div><h2>Renouvellement</h2><p>Ajoute quota et durée, sans perte d’historique.</p></div></div><div className="ds-body stack" style={{gap:10}}>
            <div className="preset-grid">{RENEWALS.map(([g,d])=><button key={g+'-'+d} type="button" className={'preset'+(renewGb===g&&renewDays===d?' active':'')} onClick={()=>{setRenewGb(g);setRenewDays(d)}}><strong>+{g} Go</strong><span>+{d} jours</span></button>)}</div>
            <div className="form-grid"><label className="field-block"><span className="field-label">Go supplémentaires</span><input className="field num" type="number" min=".01" step=".01" value={renewGb} onChange={e=>setRenewGb(Number(e.target.value))}/></label>
            <label className="field-block"><span className="field-label">Jours supplémentaires</span><input className="field num" type="number" min="1" max="366" value={renewDays} onChange={e=>setRenewDays(Number(e.target.value))}/></label></div>
            {isReseller&&<p className="field-help">Votre solde après renouvellement : <b style={{color:Number(currentUser.credits||0)-renewGb<0?'var(--danger)':'var(--text)'}}>{(Number(currentUser.credits||0)-renewGb).toFixed(2)} Go</b></p>}
            <button className="btn btn-primary" style={{width:'100%'}} disabled={working||(isReseller&&renewGb>Number(currentUser.credits||0))} onClick={()=>void run(async()=>{await renew(selected,renewGb,renewDays);return 'Licence renouvelée.'})}>Renouveler · +{renewGb} Go, +{renewDays} j</button>
          </div></section>

          <section className="drawer-section"><div className="ds-head"><div><h2>Paramètres</h2><p>Nom affiché et limite de sessions simultanées.</p></div></div><div className="ds-body">
            <div className="form-grid"><label className="field-block"><span className="field-label">Nom</span><input className="field" value={editLabel} maxLength={80} onChange={e=>setEditLabel(e.target.value)}/></label>
            <label className="field-block"><span className="field-label">Sessions</span><input className="field num" type="number" min="1" max="10" value={editConnections} onChange={e=>setEditConnections(Number(e.target.value))}/></label></div>
            <button className="btn btn-sm" style={{marginTop:10}} disabled={working||(editLabel===selected.label&&editConnections===selected.maxConnections)} onClick={()=>void run(async()=>{await patch(selected,{label:editLabel,maxConnections:editConnections});return 'Paramètres enregistrés.'})}>Enregistrer</button>
          </div></section>

          <section className="drawer-section"><div className="ds-head"><div><h2>Mot de passe SSH</h2><p>Le VPS applique le nouveau mot de passe automatiquement.</p></div><KeyRound size={14} color="var(--muted)"/></div><div className="ds-body">
            <div className="input-group"><input className="field mono" aria-label="Nouveau mot de passe SSH" placeholder="Nouveau mot de passe" value={newSshPassword} onChange={e=>setNewSshPassword(e.target.value)}/>
              <button type="button" className="icon-button" title="Générer" aria-label="Générer un nouveau mot de passe" onClick={()=>setNewSshPassword(generatePassword())}><Wand2 size={14}/></button></div>
            <button className="btn btn-sm" style={{marginTop:10}} disabled={working||!/^[A-Za-z0-9@#$%&*+=._-]{8,96}$/.test(newSshPassword)} onClick={()=>void run(async()=>{await patch(selected,{password:newSshPassword});setNewSshPassword('');setConfig(null);return 'Mot de passe modifié. Partagez la nouvelle configuration au client.'})}>Changer le mot de passe</button>
          </div></section>

          {canOperate&&<section className="drawer-section"><div className="ds-head"><div><h2>Transférer le client</h2><p>Change le revendeur propriétaire, sans mouvement de crédits.</p></div><ArrowRightLeft size={14} color="var(--muted)"/></div><div className="ds-body">
            <div className="input-group"><select className="select" aria-label="Nouveau propriétaire" value={transferTo} onChange={e=>setTransferTo(e.target.value)}><option value="">Choisir un revendeur…</option>{resellers.filter(r=>r.status==='active'&&r.id!==selected.resellerId).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <button className="btn btn-sm" disabled={working||!transferTo} onClick={()=>void run(async()=>{await patch(selected,{resellerId:transferTo});setTransferTo('');return 'Client transféré.'})}>Transférer</button></div>
          </div></section>}

          <div className="row-actions">
            {selected.provisionState==='error'?<button className="btn btn-primary" disabled={working} onClick={()=>repair(selected)}><Wrench size={13}/>Réparer le compte</button>:<button className="btn" disabled={working} onClick={()=>toggle(selected)}>{selected.enabled?<><Pause size={13}/>Suspendre</>:<><Play size={13}/>Réactiver</>}</button>}
            {canOperate&&<button className="btn btn-danger" style={{marginLeft:'auto'}} disabled={working} onClick={()=>{if(confirm('Supprimer définitivement cette licence SSH-WSS ? Le nom d’utilisateur ne pourra pas être réutilisé.'))void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+selected.id,'DELETE');setSelectedId('');return 'Licence supprimée.'})}}><Trash2 size={13}/>Supprimer</button>}
          </div>
        </>}

        {tab==='config'&&<section className="drawer-section"><div className="ds-head"><div><h2>Configuration client</h2><p>Les secrets sont chargés à la demande et audités.</p></div><KeyRound size={14} color="var(--muted)"/></div><div className="ds-body">
          {!selected.effectiveEnabled&&<p className="notice" style={{marginBottom:10}}>Licence inactive : renouvelez, réactivez ou attendez la confirmation du VPS.</p>}
          {!config?<button className="btn btn-primary" style={{width:'100%'}} disabled={working||!selected.effectiveEnabled} onClick={()=>void exportConfig()}><Eye size={14}/>Afficher la configuration</button>:<div className="stack" style={{gap:8}}>
            <div className="detail-grid"><div className="detail-item"><label>Serveur</label><strong className="mono">{config.host}:{config.port}</strong></div><div className="detail-item"><label>SNI</label><strong className="mono">{config.sni}</strong></div><div className="detail-item"><label>Utilisateur</label><strong className="mono">{config.username}</strong></div><div className="detail-item"><label>Transport</label><strong>SSH · WSS/TLS</strong></div></div>
            <div><span className="field-label">Mot de passe</span><div className="secret-value" style={{display:'flex',justifyContent:'space-between',gap:8}}><span>{showSecret?config.password:'•'.repeat(Math.min(16,config.password.length))}</span><button className="icon-button ghost" style={{width:22,height:22}} aria-label={showSecret?'Masquer':'Afficher'} onClick={()=>setShowSecret(v=>!v)}>{showSecret?<EyeOff size={12}/>:<Eye size={12}/>}</button></div></div>
            <div><span className="field-label">Chemin WebSocket personnel</span><div className="secret-value">{config.path}</div></div>
            <div><span className="field-label">Empreinte Ed25519</span><div className="secret-value">{config.fingerprint}</div></div>
            <div className="quick-grid">
              <button className="quick-action" onClick={()=>copy(clientMessage(config),'Message client copié.')}><span className="qa-icon"><Copy size={14}/></span><span><strong>Copier le message</strong><span>Texte prêt à envoyer</span></span></button>
              <a className="quick-action" href={'https://wa.me/?text='+encodeURIComponent(clientMessage(config))} target="_blank" rel="noopener noreferrer"><span className="qa-icon"><MessageCircle size={14}/></span><span><strong>WhatsApp</strong><span>Partager au client</span></span></a>
              <button className="quick-action" onClick={()=>copy(JSON.stringify(config,null,2),'Configuration JSON copiée.')}><span className="qa-icon"><Copy size={14}/></span><span><strong>Copier en JSON</strong><span>Import dans l’application</span></span></button>
              <button className="quick-action" onClick={saveConfig}><span className="qa-icon"><Download size={14}/></span><span><strong>Télécharger</strong><span>Fichier .json</span></span></button>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={()=>{setConfig(null);setShowSecret(false)}}>Masquer la configuration</button>
          </div>}
        </div></section>}

        {tab==='devices'&&<section className="drawer-section"><div className="ds-head"><div><h2>Appareils connectés</h2><p>Bloquez un appareil inconnu : il ne pourra plus se connecter.</p></div><MonitorSmartphone size={14} color="var(--muted)"/></div><div className="ds-body" style={{paddingTop:4,paddingBottom:4}}>
          {devices===null?<div className="empty-state">Chargement…</div>:!devices.length?<div className="empty-state"><Smartphone size={20}/><strong>Aucun appareil observé</strong><span>Ils apparaissent après la première connexion du client.</span></div>
          :<div className="alert-list">{devices.map(dv=><div className="alert-row" key={dv.deviceKey}>
            <div className="avatar" style={{width:28,height:28,color:dv.blocked?'var(--danger)':'var(--accent)'}}>{dv.blocked?<Ban size={13}/>:<Smartphone size={13}/>}</div>
            <div><p>{[dv.brand,dv.name].filter(Boolean).join(' ')||'Appareil '+dv.deviceKey.slice(0,6)}{(dv.activeSessions||0)>0&&<span className="badge badge-success" style={{marginLeft:6,height:18}}>en ligne</span>}</p>
              <span>{dv.ip||'IP inconnue'} · {gb(dv.usedBytes)} Go · vu {fmtDateTime(dv.lastSeenAt)}</span></div>
            <button className={'btn btn-sm'+(dv.blocked?'':' btn-danger')} disabled={working} onClick={()=>void run(async()=>{await request('/api/v1/admin/ssh/accounts/'+selected.id+'/devices/'+dv.deviceKey,'PUT',{blocked:!dv.blocked});setDevices(list=>list?.map(x=>x.deviceKey===dv.deviceKey?{...x,blocked:!dv.blocked}:x)||null);return dv.blocked?'Appareil débloqué.':'Appareil bloqué.'})}>{dv.blocked?'Débloquer':'Bloquer'}</button>
          </div>)}</div>}
        </div></section>}

        {tab==='history'&&<section className="drawer-section"><div className="ds-head"><div><h2>Historique</h2><p>Actions liées à cette licence.</p></div></div><div className="ds-body" style={{paddingTop:2,paddingBottom:2}}>
          <div className="alert-list">{events.map(e=><div className="alert-row" key={e.id}><span className="alert-dot" style={{background:'var(--accent)'}}/><div><p>{e.action.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase())}</p><span>{fmtDateTime(e.timestamp)}</span></div></div>)}</div>
          {isReseller&&<p className="field-help" style={{padding:'6px 0'}}>Le journal détaillé est réservé au Super Admin.</p>}
        </div></section>}
      </div>
    </aside></>}
  </div>;
}

import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {
  Activity,AlertTriangle,Bell,Clock3,DatabaseBackup,Download,Gauge,HardDrive,
  LayoutDashboard,LogOut,Menu,Moon,Plus,Printer,ReceiptText,RefreshCw,Server,
  Shield,Sun,Terminal,Users,WalletCards,Wifi,X
} from 'lucide-react';
import {SshCenter} from './components/SshCenter';
import {SecurityCenter} from './components/SecurityCenter';

type Role='SUPER_ADMIN'|'ADMIN'|'RESELLER';
type User={id:string,name:string,email:string,role:Role,credits:number};
type Tab='dashboard'|'clients'|'resellers'|'transactions'|'servers'|'security';
type Reseller={
  id:string;name:string;email:string;credits:number;status:string;subResellersCount?:number;
  pricePerGbCfa?:number;costPerGbCfa?:number;pricePerLicenceCfa?:number;createdAt?:string
};
type Transaction={id:string;resellerId:string;resellerName:string;type:string;amountGb:number;balanceBefore:number;balanceAfter:number;note:string;timestamp:string};
type HostTelemetry={observedAt:string;uptimeSeconds:number;cpuPercent:number;load1:number;totalMemoryBytes:number;freeMemoryBytes:number;diskTotalBytes:number;diskFreeBytes:number;services:{sshd:boolean;gateway:boolean;reconciler:boolean}};
type Node={id:string;name:string;host:string;enabled:boolean;sshWsManaged?:boolean;sshWsAgentSeenAt?:string;sshWsHost?:HostTelemetry};
type Account={
  id:string;username:string;label:string;nodeId?:string;resellerId?:string;resellerName?:string;managed:boolean;
  provisionState?:string;enabled:boolean;expiresAt:string;quotaBytes:number;usedBytes:number|null;online:number|null;
  maxConnections:number;effectiveEnabled:boolean;createdAt:string;history?:Array<{at:string;type:string;note:string}>
};
type Inventory={sshWsReady:boolean;managedNodes:Array<Node&{port:number;path:string;sni:string;agentOnline:boolean;hostTelemetry?:HostTelemetry|null}>;accounts:Account[]};
type Ops={storage?:string;freeBytes?:number;uptimeSeconds?:number;alerts?:string[];backup?:{at:string;offsite:boolean}|null};
const apiHeaders={'Content-Type':'application/json',Authorization:'Bearer cookie-session'};
const recent=(value?:string)=>Boolean(value&&Number.isFinite(Date.parse(value))&&Date.now()-Date.parse(value)>=-5000&&Date.now()-Date.parse(value)<60000);
const gb=(n:number|null|undefined)=>n==null?'—':(n/1024**3).toFixed(n/1024**3>=100?0:1);
const pct=(used:number|null,total:number)=>Math.max(0,Math.min(100,total>0?Math.round(((used||0)/total)*100):0));
const formatDuration=(seconds:number)=>{const d=Math.floor(seconds/86400),h=Math.floor((seconds%86400)/3600);return d?d+' j '+h+' h':h+' h'};
const money=(n:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'XAF',maximumFractionDigits:0}).format(n||0);

function statusOf(a:Account){
  const exp=Date.parse(a.expiresAt),days=(exp-Date.now())/86400000,usage=pct(a.usedBytes,a.quotaBytes);
  if(!a.enabled)return {label:'Suspendu',kind:'warning'};
  if(a.provisionState==='error')return {label:'Erreur VPS',kind:'danger'};
  if(exp<=Date.now())return {label:'Expiré',kind:'neutral'};
  if((a.usedBytes??0)>=a.quotaBytes)return {label:'Quota épuisé',kind:'danger'};
  if(days<=3)return {label:'Expire bientôt',kind:'warning'};
  if(usage>=90)return {label:'Quota élevé',kind:'warning'};
  if(a.provisionState==='pending')return {label:'Provisionnement',kind:'info'};
  return {label:'Actif',kind:'success'};
}

export default function App(){
  const [user,setUser]=useState<User|null>(null);
  const [checked,setChecked]=useState(false);
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [code,setCode]=useState('');
  const [mfa,setMfa]=useState(false);const [authError,setAuthError]=useState('');
  const [tab,setTab]=useState<Tab>('dashboard');const [mobileOpen,setMobileOpen]=useState(false);
  const [dark,setDark]=useState(()=>localStorage.getItem('abess_panel_theme')!=='light');
  const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
  const [resellers,setResellers]=useState<Reseller[]>([]);const [ledger,setLedger]=useState<Transaction[]>([]);
  const [nodes,setNodes]=useState<Node[]>([]);const [ops,setOps]=useState<Ops|null>(null);const [inventory,setInventory]=useState<Inventory|null>(null);
  const [notifOpen,setNotifOpen]=useState(false);const [resellerModal,setResellerModal]=useState(false);
  const [newName,setNewName]=useState('');const [newEmail,setNewEmail]=useState('');const [newPass,setNewPass]=useState('');const [newCredit,setNewCredit]=useState(0);
  const [creditAmounts,setCreditAmounts]=useState<Record<string,string>>({});
  const [pricing,setPricing]=useState<{id:string;price:number;cost:number;licence:number}|null>(null);
  const [txSearch,setTxSearch]=useState('');

  async function req(url:string,method='GET',body?:unknown){
    const res=await fetch(url,{method,credentials:'same-origin',headers:apiHeaders,body:body===undefined?undefined:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'Opération indisponible');return data;
  }
  useEffect(()=>{localStorage.removeItem('abess_admin_token');localStorage.removeItem('abess_admin_user');
    fetch('/api/v1/auth/me').then(async r=>{if(r.ok)setUser(await r.json())}).finally(()=>setChecked(true));
  },[]);
  useEffect(()=>{localStorage.setItem('abess_panel_theme',dark?'dark':'light');document.documentElement.classList.toggle('theme-light',!dark);},[dark]);
  async function login(e:FormEvent){e.preventDefault();setBusy(true);setAuthError('');
    try{const data=await req('/api/v1/auth/login','POST',{email,password,code:code.trim()});
      if(data.success&&data.user){setUser(data.user);setTab('dashboard');setPassword('');setCode('');setMfa(false)}
      else{if(data.mfaRequired)setMfa(true);setAuthError(data.error||'Accès refusé')}
    }catch(e){const m=e instanceof Error?e.message:'Connexion indisponible';if(/mfa|double|code/i.test(m))setMfa(true);setAuthError(m)}
    finally{setBusy(false)}
  }
  async function logout(){try{await req('/api/v1/auth/logout','POST',{})}catch{}setUser(null);setTab('dashboard');setInventory(null)}
  async function refresh(){
    if(!user)return;setNotice('');
    try{
      const common=[req('/api/v1/admin/resellers'),req('/api/v1/admin/transactions'),req('/api/v1/admin/ssh')];
      const extra=user.role==='SUPER_ADMIN'?[req('/api/v1/admin/nodes'),req('/api/v1/admin/operations')]:[];
      const r=await Promise.all([...common,...extra]);setResellers(r[0]);setLedger(r[1]);setInventory(r[2]);
      if(user.role==='SUPER_ADMIN'){setNodes(r[3]);setOps(r[4])}
      setUser(await req('/api/v1/auth/me'));
    }catch(e){setNotice((e as Error).message)}
  }
  useEffect(()=>{if(!user)return;void refresh();const t=setInterval(()=>void refresh(),15000);return()=>clearInterval(t)},[user?.id]);
  async function mutate(fn:()=>Promise<unknown>){setBusy(true);setNotice('');try{await fn();await refresh()}catch(e){setNotice((e as Error).message)}finally{setBusy(false)}}

  const accounts=(inventory?.accounts||[]).filter(a=>a.managed);
  const active=accounts.filter(a=>a.effectiveEnabled).length;
  const expiring=accounts.filter(a=>a.enabled&&Date.parse(a.expiresAt)>Date.now()&&Date.parse(a.expiresAt)-Date.now()<=3*86400000).length;
  const online=accounts.reduce((n,a)=>n+(a.online||0),0);
  const totalUsed=accounts.reduce((n,a)=>n+(a.usedBytes||0),0);
  const estimatedValue=accounts.reduce((sum,a)=>{
    const r=resellers.find(x=>x.id===a.resellerId);return sum+(r?.pricePerLicenceCfa||0)+(a.quotaBytes/1024**3)*(r?.pricePerGbCfa||0);
  },0);
  const notifications=useMemo(()=>{
    const list:Array<{level:'danger'|'warning'|'info';title:string;detail:string}>=[];const now=Date.now();
    for(const a of accounts){const d=(Date.parse(a.expiresAt)-now)/86400000,usage=pct(a.usedBytes,a.quotaBytes);
      if(a.provisionState==='error')list.push({level:'danger',title:a.label+' : erreur VPS',detail:'Le compte n’a pas été provisionné correctement.'});
      else if(d>0&&d<=1)list.push({level:'warning',title:a.label+' expire bientôt',detail:'Expiration dans moins de 24 heures.'});
      if(usage>=95&&a.enabled)list.push({level:'warning',title:a.label+' atteint '+usage+' %',detail:'Quota presque épuisé.'});
    }
    for(const n of inventory?.managedNodes||[])if(!n.agentOnline)list.push({level:'danger',title:n.name+' hors ligne',detail:'L’agent SSH-WSS ne répond plus.'});
    return list.slice(0,12);
  },[inventory,resellers]);

  const sevenDays=useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(6-i));
    const next=new Date(d);next.setDate(d.getDate()+1);return {label:d.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''),value:accounts.filter(a=>Date.parse(a.createdAt)>=+d&&Date.parse(a.createdAt)<+next).length};
  }),[inventory]);
  const maxChart=Math.max(1,...sevenDays.map(x=>x.value));

  if(!checked)return <div className="login-shell"><div className="login-card">Connexion sécurisée…</div></div>;
  if(!user)return <div className="login-shell"><div className="login-card">
    <div className="login-brand"><div className="brand-mark"><Terminal size={20}/></div><div><div className="brand-title">ABESS VPN</div><div className="brand-subtitle">SSH-WSS ONLY</div></div></div>
    <h1>Bienvenue</h1><p>Connectez-vous à votre centre d’administration SSH-WSS.</p>
    {authError&&<div className="notice" role="alert">{authError}</div>}
    <form onSubmit={login} className="login-form">
      <label className="field-block"><span className="field-label">Adresse email</span><input className="field" aria-label="Adresse email" type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label className="field-block"><span className="field-label">Mot de passe</span><input className="field" aria-label="Mot de passe" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {mfa&&<label className="field-block"><span className="field-label">Code de double authentification</span><input className="field" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label>}
      <button className="btn btn-primary" disabled={busy}>{busy?'Connexion…':'Se connecter'}</button>
    </form>
  </div></div>;

  const nav:Array<{id:Tab;label:string;icon:any;badge?:number}>=[
    {id:'dashboard',label:'Dashboard',icon:LayoutDashboard},
    {id:'clients',label:'Clients',icon:Users,badge:accounts.length},
    {id:'resellers',label:'Revendeurs',icon:WalletCards,badge:resellers.length},
    {id:'transactions',label:'Transactions',icon:ReceiptText},
    ...(user.role==='SUPER_ADMIN'?[{id:'servers' as Tab,label:'Serveurs',icon:Server,badge:(inventory?.managedNodes||[]).length}]:[]),
    {id:'security',label:'Sécurité',icon:Shield}
  ];
  const titles:Record<Tab,[string,string]>={
    dashboard:['Vue d’ensemble','Activité commerciale, alertes et santé SSH-WSS en temps réel.'],
    clients:['Clients','Licences, quotas, connexions, expirations et configurations SSH-WSS.'],
    resellers:['Revendeurs','Crédits, tarifs, marges et performances du réseau de vente.'],
    transactions:['Transactions','Registre financier et mouvements de crédits.'],
    servers:['Serveurs','Supervision VPS, ressources et services SSH-WSS.'],
    security:['Sécurité','Accès administrateur, MFA et sessions actives.']
  };
  const go=(id:Tab)=>{setTab(id);setMobileOpen(false)};

  return <div className="panel-shell">
    <aside className={'sidebar '+(mobileOpen?'mobile-open':'')}>
      <div className="brand-lockup"><div className="brand-mark"><Terminal size={20}/></div><div><div className="brand-title">ABESS VPN</div><div className="brand-subtitle">SSH-WSS ONLY</div></div></div>
      <div className="nav-section-label">Administration</div>
      <nav className="side-nav">{nav.map(n=><button key={n.id} onClick={()=>go(n.id)} className={'nav-button '+(tab===n.id?'active':'')} aria-current={tab===n.id?'page':undefined}><n.icon size={17}/>{n.label}{n.badge!==undefined&&<span className="nav-badge">{n.badge}</span>}</button>)}</nav>
      <div className="sidebar-footer">
        <div className="user-mini"><div className="avatar">{user.name.slice(0,1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.role==='SUPER_ADMIN'?'Super administrateur':user.role}</span></div></div>
        <div className="sidebar-actions"><button className="icon-button" aria-label="Basculer le thème" onClick={()=>setDark(v=>!v)}>{dark?<Sun size={16}/>:<Moon size={16}/>}</button><button className="icon-button" aria-label="Se déconnecter" onClick={()=>void logout()}><LogOut size={16}/></button></div>
      </div>
    </aside>
    {mobileOpen&&<button className="drawer-backdrop" aria-label="Fermer le menu" onClick={()=>setMobileOpen(false)}/>}
    <div className="main-area">
      <header className="topbar">
        <div style={{display:'flex',alignItems:'center',gap:10}}><button className="icon-button mobile-menu" aria-label="Ouvrir le menu" onClick={()=>setMobileOpen(true)}><Menu size={18}/></button><div><div className="topbar-title">{titles[tab][0]}</div><div className="topbar-subtitle">abessserveur.pagnol.xyz · TLS 443</div></div></div>
        <div className="top-actions">
          <div className="notification-trigger"><button className="icon-button" aria-label="Notifications" onClick={()=>setNotifOpen(v=>!v)}><Bell size={17}/>{notifications.length>0&&<span className="notification-count">{notifications.length}</span>}</button>
            {notifOpen&&<div className="notification-popover"><div className="section-head"><div><h2>À traiter</h2><p>Événements nécessitant une attention.</p></div></div><div className="alert-list">{notifications.length?notifications.map((n,i)=><div className="alert-row" key={i}><span className="alert-dot" style={{background:n.level==='danger'?'var(--danger)':n.level==='warning'?'var(--warning)':'var(--info)'}}/><div><p>{n.title}</p><span>{n.detail}</span></div></div>):<div className="empty-state"><Shield size={20}/><strong>Aucune alerte</strong></div>}</div></div>}
          </div>
          <button className="icon-button" aria-label="Actualiser" onClick={()=>void refresh()}><RefreshCw size={17}/></button>
        </div>
      </header>
      <main className="main-content">
        <div className="page-header"><div><h1>{titles[tab][0]}</h1><p>{titles[tab][1]}</p></div>
          {tab==='clients'&&<div className="page-actions"><button className="btn btn-primary" onClick={()=>window.dispatchEvent(new CustomEvent('abess:new-client'))}><Plus size={15}/>Nouveau client</button></div>}
          {tab==='resellers'&&<div className="page-actions"><button className="btn btn-primary" onClick={()=>setResellerModal(true)}><Plus size={15}/>Nouveau revendeur</button></div>}
        </div>
        {notice&&<div className="notice">{notice}</div>}

        {tab==='dashboard'&&<div className="stack">
          <div className="metric-grid">
            <div className="card metric-card"><div className="metric-label"><Users size={15}/>Clients actifs</div><div className="metric-value">{active}</div><div className="metric-foot">{accounts.length} comptes au total</div></div>
            <div className="card metric-card"><div className="metric-label"><Clock3 size={15}/>Expirent bientôt</div><div className="metric-value">{expiring}</div><div className="metric-foot">dans les 3 prochains jours</div></div>
            <div className="card metric-card"><div className="metric-label"><Wifi size={15}/>Sessions en ligne</div><div className="metric-value">{online}</div><div className="metric-foot">connexions WSS observées</div></div>
            <div className="card metric-card"><div className="metric-label"><Gauge size={15}/>Trafic consommé</div><div className="metric-value">{gb(totalUsed)} Go</div><div className="metric-foot">mesuré par la passerelle SSH</div></div>
          </div>
          <div className="grid-2">
            <div className="card card-pad"><div className="section-head"><div><h2>Nouveaux clients · 7 jours</h2><p>Créations de licences SSH-WSS.</p></div><span className="badge badge-success">{accounts.filter(a=>Date.parse(a.createdAt)>Date.now()-7*86400000).length} nouveaux</span></div>
              <div className="chart">{sevenDays.map(d=><div className="chart-column" key={d.label}><span className="chart-value">{d.value}</span><div className="chart-bar" style={{height:(d.value/maxChart*100)+'%'}}/><span className="chart-label">{d.label}</span></div>)}</div>
            </div>
            <div className="card card-pad"><div className="section-head"><div><h2>Alertes opérationnelles</h2><p>Priorités détectées automatiquement.</p></div><span className={'badge '+(notifications.length?'badge-warning':'badge-success')}>{notifications.length||'OK'}</span></div>
              <div className="alert-list">{notifications.slice(0,5).map((n,i)=><div className="alert-row" key={i}><span className="alert-dot" style={{background:n.level==='danger'?'var(--danger)':'var(--warning)'}}/><div><p>{n.title}</p><span>{n.detail}</span></div></div>)}{!notifications.length&&<div className="empty-state"><Shield size={22}/><strong>Tout est normal</strong><span>Aucune action urgente.</span></div>}</div>
            </div>
          </div>
          <div className="grid-equal">
            <div className="card card-pad"><div className="section-head"><div><h2>Activité récente</h2><p>Derniers mouvements de crédits.</p></div><button className="btn btn-sm" onClick={()=>go('transactions')}>Voir le registre</button></div>
              {(ledger.slice().sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,6)).map(t=><div className="service-line" key={t.id}><span><strong>{t.resellerName}</strong><span className="table-secondary">{t.note}</span></span><span>{t.amountGb} Go</span></div>)}
            </div>
            <div className="card card-pad"><div className="section-head"><div><h2>Performance commerciale</h2><p>Valeur estimée selon les tarifs configurés.</p></div></div>
              <div className="detail-grid"><div className="detail-item"><label>Valeur des licences</label><strong>{money(estimatedValue)}</strong></div><div className="detail-item"><label>Revendeurs actifs</label><strong>{resellers.filter(r=>r.status==='active').length}</strong></div><div className="detail-item"><label>Solde revendeurs</label><strong>{resellers.reduce((n,r)=>n+(r.credits||0),0).toFixed(1)} Go</strong></div><div className="detail-item"><label>VPS opérationnels</label><strong>{(inventory?.managedNodes||[]).filter(n=>n.agentOnline).length} / {(inventory?.managedNodes||[]).length}</strong></div></div>
            </div>
          </div>
        </div>}

        {tab==='clients'&&<SshCenter token="cookie-session" isAdmin={user.role!=='RESELLER'}/>}
        {tab==='security'&&<SecurityCenter token="cookie-session" onLogout={()=>void logout()}/>}

        {tab==='resellers'&&<div className="stack">
          <div className="metric-grid">
            <div className="card metric-card"><div className="metric-label"><WalletCards size={15}/>Revendeurs actifs</div><div className="metric-value">{resellers.filter(r=>r.status==='active').length}</div><div className="metric-foot">{resellers.length} au total</div></div>
            <div className="card metric-card"><div className="metric-label"><Gauge size={15}/>Crédits disponibles</div><div className="metric-value">{resellers.reduce((n,r)=>n+r.credits,0).toFixed(1)} Go</div><div className="metric-foot">répartis dans le réseau</div></div>
            <div className="card metric-card"><div className="metric-label"><Users size={15}/>Clients attribués</div><div className="metric-value">{accounts.filter(a=>a.resellerId&&resellers.some(r=>r.id===a.resellerId)).length}</div><div className="metric-foot">licences gérées par revendeurs</div></div>
            <div className="card metric-card"><div className="metric-label"><Activity size={15}/>Valeur estimée</div><div className="metric-value">{money(estimatedValue)}</div><div className="metric-foot">selon les tarifs actuels</div></div>
          </div>
          <div className="card card-pad"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Revendeur</th><th>Solde</th><th>Clients</th><th>Tarif / Go</th><th>Marge / Go</th><th>État</th><th>Actions</th></tr></thead><tbody>
            {resellers.map(r=>{const clients=accounts.filter(a=>a.resellerId===r.id).length,margin=(r.pricePerGbCfa||0)-(r.costPerGbCfa||0);return <tr key={r.id}><td><div className="table-primary">{r.name}</div><div className="table-secondary">{r.email}</div></td><td>{r.credits.toFixed(2)} Go</td><td>{clients}</td><td>{money(r.pricePerGbCfa||0)}</td><td>{money(margin)}</td><td><span className={'badge '+(r.status==='active'?'badge-success':'badge-warning')}>{r.status==='active'?'Actif':'Suspendu'}</span></td><td><div className="row-actions"><input className="field" style={{width:86}} type="number" min="0.01" step="0.01" placeholder="Go" value={creditAmounts[r.id]||''} onChange={e=>setCreditAmounts(v=>({...v,[r.id]:e.target.value}))}/><button className="btn btn-sm" disabled={!Number(creditAmounts[r.id])||busy} onClick={()=>void mutate(async()=>{await req('/api/v1/admin/resellers/'+r.id+'/credit','PUT',{amount:Number(creditAmounts[r.id])});setCreditAmounts(v=>({...v,[r.id]:''}))})}>Créditer</button>{user.role!=='RESELLER'&&<button className="btn btn-sm" onClick={()=>setPricing({id:r.id,price:r.pricePerGbCfa||0,cost:r.costPerGbCfa||0,licence:r.pricePerLicenceCfa||0})}>Tarifs</button>}</div></td></tr>})}
          </tbody></table></div></div>
        </div>}

        {tab==='transactions'&&<div className="stack"><div className="card card-pad">
          <div className="toolbar"><input className="search-input" type="search" placeholder="Rechercher une transaction…" value={txSearch} onChange={e=>setTxSearch(e.target.value)}/><div style={{marginLeft:'auto',display:'flex',gap:8}}><button className="btn btn-sm" onClick={()=>{const rows=[['Date','Revendeur','Action','Go','Avant','Après','Note'],...ledger.map(t=>[t.timestamp,t.resellerName,t.type,t.amountGb,t.balanceBefore,t.balanceAfter,t.note])];const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=u;a.download='abess-transactions.csv';a.click();URL.revokeObjectURL(u)}}><Download size={14}/>CSV</button><button className="btn btn-sm" onClick={()=>window.print()}><Printer size={14}/>Imprimer / PDF</button></div></div>
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Revendeur</th><th>Action</th><th>Go</th><th>Solde avant</th><th>Solde après</th><th>Détail</th></tr></thead><tbody>{ledger.filter(t=>(t.resellerName+' '+t.type+' '+t.note).toLowerCase().includes(txSearch.toLowerCase())).slice().sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).map(t=><tr key={t.id}><td>{new Date(t.timestamp).toLocaleString('fr-FR')}</td><td>{t.resellerName}</td><td><span className="badge badge-info">{t.type}</span></td><td>{t.amountGb}</td><td>{t.balanceBefore}</td><td>{t.balanceAfter}</td><td>{t.note}</td></tr>)}</tbody></table></div>
        </div></div>}

        {tab==='servers'&&user.role==='SUPER_ADMIN'&&<div className="stack">
          <div className="metric-grid"><div className="card metric-card"><div className="metric-label"><Server size={15}/>VPS gérés</div><div className="metric-value">{inventory?.managedNodes.length||0}</div><div className="metric-foot">nœuds SSH-WSS</div></div><div className="card metric-card"><div className="metric-label"><Wifi size={15}/>Agents en ligne</div><div className="metric-value">{inventory?.managedNodes.filter(n=>n.agentOnline).length||0}</div><div className="metric-foot">heartbeat &lt; 60 s</div></div><div className="card metric-card"><div className="metric-label"><HardDrive size={15}/>Disque API libre</div><div className="metric-value">{ops?.freeBytes?gb(ops.freeBytes)+' Go':'—'}</div><div className="metric-foot">{ops?.storage||'stockage'}</div></div><div className="card metric-card"><div className="metric-label"><DatabaseBackup size={15}/>Sauvegarde</div><div className="metric-value" style={{fontSize:17}}>{ops?.backup?.at?new Date(ops.backup.at).toLocaleDateString('fr-FR'):'À vérifier'}</div><div className="metric-foot">{ops?.backup?.offsite?'copie hors site confirmée':'locale / non confirmée'}</div></div></div>
          <div className="server-grid">{(inventory?.managedNodes||[]).map(n=>{const h=n.hostTelemetry;const mem=h?Math.round((1-h.freeMemoryBytes/h.totalMemoryBytes)*100):0,disk=h?Math.round((1-h.diskFreeBytes/h.diskTotalBytes)*100):0;return <div className="card card-pad" key={n.id}><div className="section-head"><div><h2>{n.name}</h2><p>{n.host} · {n.sni}:{n.port}{n.path}</p></div><span className={'badge '+(n.agentOnline?'badge-success':'badge-danger')}>{n.agentOnline?'En ligne':'Hors ligne'}</span></div>{h?<><div className="server-metrics"><div className="server-metric"><label>CPU</label><strong>{h.cpuPercent.toFixed(0)} %</strong></div><div className="server-metric"><label>RAM</label><strong>{mem} %</strong></div><div className="server-metric"><label>Disque</label><strong>{disk} %</strong></div><div className="server-metric"><label>Uptime</label><strong>{formatDuration(h.uptimeSeconds)}</strong></div></div><div style={{marginTop:14}}><div className="service-line"><span>OpenSSH dédié</span><span className={'badge '+(h.services.sshd?'badge-success':'badge-danger')}>{h.services.sshd?'Actif':'Arrêté'}</span></div><div className="service-line"><span>Gateway WebSocket</span><span className={'badge '+(h.services.gateway?'badge-success':'badge-danger')}>{h.services.gateway?'Actif':'Arrêté'}</span></div><div className="service-line"><span>Agent Reconciler</span><span className={'badge '+(h.services.reconciler?'badge-success':'badge-danger')}>{h.services.reconciler?'Actif':'Arrêté'}</span></div></div></>:<div className="empty-state"><AlertTriangle size={22}/><strong>Télémétrie indisponible</strong><span>Le prochain heartbeat de l’agent actualisera les métriques.</span></div>}</div>})}</div>
          <div className="card card-pad"><div className="section-head"><div><h2>Sauvegarde & exploitation</h2><p>Les sauvegardes sont chiffrées avant téléchargement.</p></div></div><button className="btn" onClick={()=>void mutate(async()=>{const response=await fetch('/api/v1/admin/operations/backup',{credentials:'same-origin',headers:apiHeaders});if(!response.ok)throw Error('Sauvegarde impossible');const blob=await response.blob();const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='abess-backup-'+Date.now()+'.encrypted.json';a.click();URL.revokeObjectURL(u)})}><DatabaseBackup size={15}/>Télécharger une sauvegarde chiffrée</button></div>
        </div>}
      </main>
    </div>

    {resellerModal&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><strong>Nouveau revendeur</strong><button className="icon-button" onClick={()=>setResellerModal(false)}><X size={16}/></button></div><form onSubmit={e=>{e.preventDefault();void mutate(async()=>{await req('/api/v1/admin/resellers','POST',{name:newName,email:newEmail,password:newPass,initialCredits:newCredit});setNewName('');setNewEmail('');setNewPass('');setNewCredit(0);setResellerModal(false)})}}><div className="modal-body form-grid"><label className="field-block"><span className="field-label">Nom</span><input className="field" required value={newName} onChange={e=>setNewName(e.target.value)}/></label><label className="field-block"><span className="field-label">Email</span><input className="field" type="email" required value={newEmail} onChange={e=>setNewEmail(e.target.value)}/></label><label className="field-block"><span className="field-label">Mot de passe</span><input className="field" type="password" minLength={12} required value={newPass} onChange={e=>setNewPass(e.target.value)}/></label><label className="field-block"><span className="field-label">Crédits initiaux (Go)</span><input className="field" type="number" min="0" step="0.01" value={newCredit} onChange={e=>setNewCredit(Number(e.target.value))}/></label></div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setResellerModal(false)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Créer le revendeur</button></div></form></div></div>}
    {pricing&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><strong>Tarification revendeur</strong><button className="icon-button" onClick={()=>setPricing(null)}><X size={16}/></button></div><div className="modal-body form-grid"><label className="field-block"><span className="field-label">Prix de vente / Go (FCFA)</span><input className="field" type="number" min="0" value={pricing.price} onChange={e=>setPricing({...pricing,price:Number(e.target.value)})}/></label><label className="field-block"><span className="field-label">Coût / Go (FCFA)</span><input className="field" type="number" min="0" value={pricing.cost} onChange={e=>setPricing({...pricing,cost:Number(e.target.value)})}/></label><label className="field-block"><span className="field-label">Prix fixe / licence (FCFA)</span><input className="field" type="number" min="0" value={pricing.licence} onChange={e=>setPricing({...pricing,licence:Number(e.target.value)})}/></label><div className="detail-item"><label>Marge estimée / Go</label><strong>{money(pricing.price-pricing.cost)}</strong></div></div><div className="modal-foot"><button className="btn" onClick={()=>setPricing(null)}>Annuler</button><button className="btn btn-primary" disabled={busy} onClick={()=>void mutate(async()=>{await req('/api/v1/admin/resellers/'+pricing.id+'/pricing','PUT',{pricePerGbCfa:pricing.price,costPerGbCfa:pricing.cost,pricePerLicenceCfa:pricing.licence});setPricing(null)})}>Enregistrer</button></div></div></div>}
  </div>;
}

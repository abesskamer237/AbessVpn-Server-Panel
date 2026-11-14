import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Bell,ChartNoAxesCombined,CreditCard,FileSearch,History,LogOut,Menu,Moon,ReceiptText,RefreshCw,Server,Shield,Sun,Terminal,UserCog,Users} from 'lucide-react';
import {AuditCenter} from './components/AuditCenter';
import {BillingCenter} from './components/BillingCenter';
import {Dashboard} from './components/Dashboard';
import {ResellerCenter} from './components/ResellerCenter';
import {SecurityCenter} from './components/SecurityCenter';
import {ServerCenter} from './components/ServerCenter';
import {SshCenter} from './components/SshCenter';
import {TeamCenter} from './components/TeamCenter';
import {TransactionsCenter} from './components/TransactionsCenter';
import type {AuditEvent,ManagedNode,Operator,OpsHealth,Reseller,Role,SshInventory,Transaction,User} from './panelTypes';
import {accountStatus,fmtDate} from './panelTypes';

type Tab='dashboard'|'clients'|'resellers'|'billing'|'transactions'|'servers'|'audit'|'security'|'team';
const superOnly:Tab[]=['servers','audit','team'];
type RawNode={
  id:string;name:string;host:string;enabled:boolean;sshWsManaged?:boolean;sshWsAgentSeenAt?:string;
  sshWsSni?:string;sshWsPort?:number;sshWsPath?:string;sshWsHost?:ManagedNode['hostTelemetry'];
};
const titles:Record<Tab,string>={
  dashboard:'Tableau de bord',clients:'Clients',resellers:'Revendeurs',billing:'Facturation',transactions:'Transactions',
  servers:'Serveurs',audit:'Journal d’audit',security:'Sécurité',team:'Équipe'
};
const subtitles:Record<Tab,string>={
  dashboard:'Vue d’ensemble de votre activité SSH-WSS',
  clients:'Licences, quotas et connexions',
  resellers:'Portefeuille et crédits commerciaux',
  billing:'Offres, paiements Mobile Money et factures',
  audit:'Traçabilité des actions sensibles',
  transactions:'Mouvements et historique',
  servers:'Infrastructure et supervision VPS',
  security:'Protection de votre compte',
  team:'Administrateurs et permissions'
};

const httpMessage=(status:number)=>status===403?'Action non autorisée pour votre rôle.':status===404?'Élément introuvable.':status===409?'Conflit : l’élément a changé ou existe déjà.':status===429?'Trop de tentatives. Patientez quelques minutes.':status>=500?'Le serveur a rencontré une erreur. Réessayez.':'Opération indisponible.';

export default function App(){
  const [user,setUser]=useState<User|null>(null),[checked,setChecked]=useState(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
  const [mfa,setMfa]=useState(false),[authError,setAuthError]=useState('');
  const [tab,setTab]=useState<Tab>('dashboard'),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [dark,setDark]=useState(()=>localStorage.getItem('abess_panel_theme')!=='light');
  const [mobileOpen,setMobileOpen]=useState(false),[notificationsOpen,setNotificationsOpen]=useState(false);
  const [notice,setNotice]=useState(''),[createSignal,setCreateSignal]=useState(0);
  const [resellers,setResellers]=useState<Reseller[]>([]),[transactions,setTransactions]=useState<Transaction[]>([]);
  const [inventory,setInventory]=useState<SshInventory|null>(null),[nodes,setNodes]=useState<RawNode[]>([]);
  const [ops,setOps]=useState<OpsHealth|null>(null),[audit,setAudit]=useState<AuditEvent[]>([]),[operators,setOperators]=useState<Operator[]>([]);
  const [lastSync,setLastSync]=useState<Date|null>(null);

  async function request(url:string,method='GET',body?:unknown,extraHeaders?:Record<string,string>){
    const response=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});
    const data=response.status===204?{}:await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401&&!url.startsWith('/api/v1/auth/login')){setUser(null);setAuthError('Votre session a expiré. Reconnectez-vous.')}
      throw new Error(data.error||httpMessage(response.status));
    }
    return data;
  }
  useEffect(()=>{
    localStorage.removeItem('abess_admin_token');localStorage.removeItem('abess_admin_user');
    fetch('/api/v1/auth/me',{credentials:'same-origin'}).then(async r=>{if(r.ok){const u=await r.json();setUser(u)}}).finally(()=>setChecked(true));
  },[]);
  useEffect(()=>{
    localStorage.setItem('abess_panel_theme',dark?'dark':'light');
    document.documentElement.classList.toggle('theme-light',!dark);
  },[dark]);

  async function login(e:FormEvent){
    e.preventDefault();setBusy(true);setAuthError('');
    try{
      const data=await request('/api/v1/auth/login','POST',{email,password,code:code.trim()});
      if(data.success&&data.user){setUser(data.user);setTab('dashboard');setPassword('');setCode('');setMfa(false)}
      else{if(data.mfaRequired)setMfa(true);setAuthError(data.error||'Accès refusé')}
    }catch(e){const m=e instanceof Error?e.message:'Connexion indisponible';if(/authentification|mfa|code/i.test(m))setMfa(true);setAuthError(m)}
    finally{setBusy(false)}
  }
  async function logout(){
    try{await request('/api/v1/auth/logout','POST',{})}catch{}
    setUser(null);setTab('dashboard');setInventory(null);setResellers([]);setTransactions([]);setNodes([]);setOps(null);setAudit([]);setOperators([]);
  }
  async function refresh(){
    if(!user)return;
    setLoading(true);setNotice('');
    try{
      const [r,t,ssh,me]=await Promise.all([
        request('/api/v1/admin/resellers'),request('/api/v1/admin/transactions'),request('/api/v1/admin/ssh'),request('/api/v1/auth/me')
      ]);
      setResellers(r);setTransactions(t);setInventory(ssh);setUser(me);setLastSync(new Date());
      if(me.role==='SUPER_ADMIN'){
        const [rawNodes,health,logs,team]=await Promise.all([
          request('/api/v1/admin/nodes'),request('/api/v1/admin/operations'),request('/api/v1/admin/audit-logs'),request('/api/v1/admin/operators')
        ]);
        setNodes(rawNodes);setOps(health);setAudit([...logs].sort((a:any,b:any)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)));setOperators(team);
      }else{setNodes([]);setOps(null);setAudit([]);setOperators([])}
    }catch(e){setNotice(e instanceof Error?e.message:'Actualisation impossible')}
    finally{setLoading(false)}
  }
  useEffect(()=>{
    if(!user)return;void refresh();
    // Poll only while the tab is visible: avoids useless load on the API.
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},15000);
    return()=>window.clearInterval(timer);
  },[user?.id]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setNotificationsOpen(false);setMobileOpen(false)}};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[]);
  useEffect(()=>{document.title=(user?titles[tab]+' · ':'')+'ABESS VPN'},[tab,user?.id]);

  const notifications=useMemo(()=>{
    const list:{tone:'danger'|'warning'|'info',title:string,detail:string,tab:Tab}[]=[];
    for(const n of inventory?.managedNodes||[])if(!n.agentOnline)list.push({tone:'danger',title:n.name+' hors ligne',detail:'Agent SSH-WSS non connecté',tab:'servers'});
    for(const a of inventory?.accounts||[]){
      if(!a.managed)continue;const st=accountStatus(a);
      if(st.key==='quota')list.push({tone:'danger',title:a.label+' · quota épuisé',detail:a.username,tab:'clients'});
      if(st.key==='expiring')list.push({tone:'warning',title:a.label+' expire bientôt',detail:fmtDate(a.expiresAt),tab:'clients'});
      if(st.key==='error')list.push({tone:'danger',title:'Erreur de création VPS',detail:a.label,tab:'clients'});
    }
    if(ops?.alerts?.includes('BACKUP_OVERDUE'))list.push({tone:'warning',title:'Sauvegarde en retard',detail:'Vérifie la stratégie de sauvegarde',tab:'servers'});
    return list.slice(0,20);
  },[inventory,ops]);

  function go(next:string){
    const target=next as Tab;
    if(!(target in titles)||(superOnly.includes(target)&&user?.role!=='SUPER_ADMIN')){setTab('dashboard');return}
    setTab(target);setMobileOpen(false);setNotificationsOpen(false);
  }

  if(!checked)return <div className="login-shell"><div className="login-card">Chargement sécurisé…</div></div>;
  if(!user)return <div className="login-shell"><div className="login-layout">
    <section className="login-aside" aria-hidden="true">
      <img src="/favicon.svg" alt="" width={64} height={64}/>
      <h2>Votre activité VPN, pilotée depuis un seul endroit.</h2>
      <ul>
        <li><Users size={15}/>Clients SSH-WSS, quotas et sessions en temps réel</li>
        <li><CreditCard size={15}/>Réseau de revendeurs multi-niveaux et crédits</li>
        <li><ReceiptText size={15}/>Paiements MTN MoMo / Orange Money et factures</li>
        <li><Shield size={15}/>Double authentification et journal d’audit</li>
      </ul>
    </section>
    <div className="login-card">
    <div className="login-brand"><div className="brand-mark"><Terminal size={20}/></div><div><div className="brand-title">ABESS VPN</div><div className="brand-subtitle">SSH-WSS CONTROL</div></div></div>
    <h1>Bienvenue</h1><p>Connectez-vous au centre de gestion sécurisé.</p>
    {authError&&<p className="notice" role="alert">{authError}</p>}
    <form className="login-form" onSubmit={login}>
      <label className="field-block"><span className="field-label">Adresse email</span><input className="field" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label className="field-block"><span className="field-label">Mot de passe</span><input className="field" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {mfa&&<label className="field-block"><span className="field-label">Code de double authentification</span><input className="field" autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value)}/></label>}
      <button className="btn btn-primary" style={{width:'100%',padding:12}} disabled={busy}>{busy?'Connexion…':'Se connecter'}</button>
    </form>
  </div></div></div>;

  const roleLabel:Record<Role,string>={SUPER_ADMIN:'Super Admin',ADMIN:'Administrateur',RESELLER:'Revendeur'};
  const nav=[
    {id:'dashboard' as Tab,label:'Tableau de bord',icon:ChartNoAxesCombined},
    {id:'clients' as Tab,label:'Clients',icon:Users,badge:(inventory?.accounts||[]).filter(a=>a.managed).length},
    {id:'resellers' as Tab,label:'Revendeurs',icon:CreditCard},
    {id:'billing' as Tab,label:'Facturation',icon:ReceiptText},
    {id:'transactions' as Tab,label:'Transactions',icon:History},
    ...(user.role==='SUPER_ADMIN'?[{id:'servers' as Tab,label:'Serveurs',icon:Server,badge:(inventory?.managedNodes||[]).filter(n=>!n.agentOnline).length||undefined}]:[]),
    ...(user.role==='SUPER_ADMIN'?[{id:'audit' as Tab,label:'Journal d’audit',icon:FileSearch}]:[]),
    {id:'security' as Tab,label:'Sécurité',icon:Shield},
    ...(user.role==='SUPER_ADMIN'?[{id:'team' as Tab,label:'Équipe',icon:UserCog}]:[])
  ];
  const people=new Map<string,string>([[user.id,user.name],...resellers.map(r=>[r.id,r.name] as [string,string]),...operators.map(o=>[o.id,o.name] as [string,string])]);
  const serverNodes=(nodes.map(n=>({
    id:n.id,name:n.name,host:n.host,sni:n.sshWsSni||n.host,port:n.sshWsPort||443,path:n.sshWsPath||'/ssh-ws',
    agentOnline:Boolean(n.sshWsAgentSeenAt&&Date.now()-Date.parse(n.sshWsAgentSeenAt)<60000),hostTelemetry:n.sshWsHost||null,enabled:n.enabled,sshWsManaged:n.sshWsManaged,sshWsAgentSeenAt:n.sshWsAgentSeenAt
  })) as any[]);

  return <div className="panel-shell">
    {mobileOpen&&<div className="drawer-backdrop" style={{zIndex:29}} onClick={()=>setMobileOpen(false)}/>}
    <aside className={'sidebar '+(mobileOpen?'mobile-open':'')}>
      <div className="brand-lockup"><div className="brand-mark"><Terminal size={20}/></div><div><div className="brand-title">ABESS VPN</div><div className="brand-subtitle">SSH-WSS ONLY</div></div></div>
      <div className="nav-section-label">Gestion</div>
      <nav className="side-nav">{nav.slice(0,5).map(item=><button key={item.id} className={'nav-button '+(tab===item.id?'active':'')} onClick={()=>go(item.id)}><item.icon size={16}/>{item.label}{item.badge!==undefined&&<span className="nav-badge">{item.badge}</span>}</button>)}</nav>
      <div className="nav-section-label">Administration</div>
      <nav className="side-nav">{nav.slice(5).map(item=><button key={item.id} className={'nav-button '+(tab===item.id?'active':'')} onClick={()=>go(item.id)}><item.icon size={16}/>{item.label}{item.badge!==undefined&&<span className="nav-badge">{item.badge}</span>}</button>)}</nav>
      <div className="sidebar-footer">
        <div className="user-mini"><div className="avatar">{user.name.slice(0,1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{roleLabel[user.role]}{user.role==='RESELLER'?' · '+Number(user.credits||0).toFixed(2)+' Go':''}</span></div></div>
        <div className="sidebar-actions"><button className="icon-button" aria-label="Changer le thème" onClick={()=>setDark(v=>!v)}>{dark?<Sun size={16}/>:<Moon size={16}/>}</button><button className="icon-button" aria-label="Se déconnecter" onClick={()=>void logout()}><LogOut size={16}/></button></div>
      </div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <div style={{display:'flex',alignItems:'center',gap:10}}><button className="icon-button mobile-menu" aria-label="Ouvrir le menu" onClick={()=>setMobileOpen(true)}><Menu size={17}/></button><div><div className="topbar-title">{titles[tab]}</div><div className="topbar-subtitle">{subtitles[tab]}{lastSync&&<span className="sync-hint"> · synchronisé à {lastSync.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>}</div></div></div>
        <div className="top-actions">
          <button className="icon-button" title="Actualiser" aria-label="Actualiser" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16} className={loading?'animate-spin':''}/></button>
          <div className="notification-trigger"><button className="icon-button" aria-label="Notifications" onClick={()=>setNotificationsOpen(v=>!v)}><Bell size={16}/>{notifications.length>0&&<span className="notification-count">{notifications.length}</span>}</button>
            {notificationsOpen&&<div className="notification-popover"><div className="section-head"><div><h2>Notifications</h2><p>{notifications.length} élément(s) à surveiller</p></div></div>
              <div className="alert-list">{notifications.length?notifications.map((n,i)=><button key={i} className="alert-row" style={{textAlign:'left',width:'100%',color:'inherit'}} onClick={()=>go(n.tab)}><span className="alert-dot" style={{background:n.tone==='danger'?'var(--danger)':n.tone==='warning'?'var(--warning)':'var(--info)'}}/><div><p>{n.title}</p><span>{n.detail}</span></div></button>):<div className="empty-state" style={{padding:18}}><Bell size={20}/><strong>Tout est calme</strong></div>}</div>
            </div>}
          </div>
          <button className="btn btn-primary topbar-cta" onClick={()=>{go('clients');setCreateSignal(v=>v+1)}}><Users size={14}/><span>Nouveau client</span></button>
        </div>
      </header>

      <main className="main-content">
        {notice&&<p className="notice" role="alert" style={{marginBottom:14}}>{notice}</p>}
        {tab==='dashboard'&&<Dashboard inventory={inventory} transactions={transactions} resellers={resellers} audit={audit} ops={ops} role={user.role} onNavigate={go} onCreateClient={()=>{go('clients');setCreateSignal(v=>v+1)}}/>}
        {tab==='clients'&&<SshCenter inventory={inventory} resellers={resellers} role={user.role} audit={audit} request={request} refresh={refresh} createSignal={createSignal}/>}
        {tab==='resellers'&&<ResellerCenter resellers={resellers} accounts={(inventory?.accounts||[]).filter(a=>a.managed)} busy={busy} currentUser={user} request={request} refresh={refresh}/>}
        {tab==='billing'&&<BillingCenter currentUser={user} role={user.role} request={request} onCreditsChanged={refresh}/>}
        {tab==='transactions'&&<TransactionsCenter transactions={transactions}/>}
        {tab==='audit'&&user.role==='SUPER_ADMIN'&&<AuditCenter audit={audit} people={people}/>}
        {tab==='servers'&&user.role==='SUPER_ADMIN'&&<ServerCenter nodes={serverNodes} ops={ops} audit={audit} busy={busy} request={request} refresh={refresh}/>}
        {tab==='security'&&<div className="stack"><div className="page-header"><div><h1>Sécurité</h1><p>MFA, mot de passe et sessions administratives.</p></div></div><SecurityCenter request={request} onLogout={()=>void logout()}/></div>}
        {tab==='team'&&user.role==='SUPER_ADMIN'&&<TeamCenter operators={operators} busy={busy} request={request} refresh={refresh}/>}
      </main>
    </div>
  </div>;
}

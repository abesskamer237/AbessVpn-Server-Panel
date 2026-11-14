import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Bell,ChartNoAxesCombined,ChevronRight,CreditCard,Eye,EyeOff,FileSearch,History,KeyRound,LogOut,Menu,Moon,PanelLeftClose,PanelLeftOpen,Plus,ReceiptText,RefreshCw,Search,Server,Shield,Sun,UserCog,Users,Wallet} from 'lucide-react';
import {AuditCenter} from './components/AuditCenter';
import {BillingCenter} from './components/BillingCenter';
import {CommandPalette,type Command} from './components/CommandPalette';
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
const sections:Record<Tab,string>={
  dashboard:'Pilotage',clients:'Commerce',resellers:'Commerce',billing:'Commerce',transactions:'Commerce',
  servers:'Infrastructure',audit:'Administration',security:'Compte',team:'Administration'
};
const roleLabel:Record<Role,string>={SUPER_ADMIN:'Super Admin',ADMIN:'Administrateur',RESELLER:'Revendeur'};

const httpMessage=(status:number)=>status===403?'Action non autorisée pour votre rôle.':status===404?'Élément introuvable.':status===409?'Conflit : l’élément a changé ou existe déjà.':status===429?'Trop de tentatives. Patientez quelques minutes.':status>=500?'Le serveur a rencontré une erreur. Réessayez.':'Opération indisponible.';
const stored=(key:string)=>{try{return localStorage.getItem(key)}catch{return null}};
const store=(key:string,value:string)=>{try{localStorage.setItem(key,value)}catch{/* private mode */}};

function Logo(){return <div className="brand-mark"><img src="/favicon.svg" alt=""/></div>}

export default function App(){
  const [user,setUser]=useState<User|null>(null),[checked,setChecked]=useState(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[showPassword,setShowPassword]=useState(false);
  const [mfa,setMfa]=useState(false),[authError,setAuthError]=useState('');
  const [tab,setTab]=useState<Tab>('dashboard'),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [dark,setDark]=useState(()=>stored('abess_panel_theme')!=='light');
  const [collapsed,setCollapsed]=useState(()=>stored('abess_panel_rail')==='1');
  const [mobileOpen,setMobileOpen]=useState(false),[notificationsOpen,setNotificationsOpen]=useState(false),[paletteOpen,setPaletteOpen]=useState(false);
  const [notice,setNotice]=useState(''),[createSignal,setCreateSignal]=useState(0),[openClient,setOpenClient]=useState<{id:string;n:number}|null>(null);
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
    try{localStorage.removeItem('abess_admin_token');localStorage.removeItem('abess_admin_user')}catch{/* ignore */}
    fetch('/api/v1/auth/me',{credentials:'same-origin'}).then(async r=>{if(r.ok){const u=await r.json();setUser(u)}}).finally(()=>setChecked(true));
  },[]);
  useEffect(()=>{store('abess_panel_theme',dark?'dark':'light');document.documentElement.classList.toggle('theme-light',!dark)},[dark]);
  useEffect(()=>{store('abess_panel_rail',collapsed?'1':'0')},[collapsed]);

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
    try{await request('/api/v1/auth/logout','POST',{})}catch{/* already signed out */}
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
    const onKey=(e:KeyboardEvent)=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPaletteOpen(v=>!v);return}
      if(e.key==='Escape'){setNotificationsOpen(false);setMobileOpen(false)}
    };
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
    setTab(target);setMobileOpen(false);setNotificationsOpen(false);window.scrollTo({top:0});
  }
  const newClient=()=>{go('clients');setCreateSignal(v=>v+1)};

  const commands=useMemo<Command[]>(()=>{
    if(!user)return [];
    const pages:[Tab,typeof Users][]=[['dashboard',ChartNoAxesCombined],['clients',Users],['resellers',CreditCard],['billing',ReceiptText],['transactions',History],
      ...(user.role==='SUPER_ADMIN'?[['servers',Server],['audit',FileSearch],['team',UserCog]] as [Tab,typeof Users][]:[]),['security',Shield]];
    return [
      ...pages.map(([id,icon])=>({id:'nav-'+id,group:'Navigation',label:titles[id],icon,keywords:sections[id],run:()=>go(id)})),
      {id:'act-client',group:'Actions',label:'Créer un client SSH-WSS',icon:Plus,keywords:'nouveau licence',run:newClient},
      {id:'act-credits',group:'Actions',label:user.role==='SUPER_ADMIN'?'Vérifier les paiements':'Acheter des crédits',icon:Wallet,keywords:'facture commande paiement momo orange',run:()=>go('billing')},
      {id:'act-refresh',group:'Actions',label:'Actualiser les données',icon:RefreshCw,run:()=>void refresh()},
      {id:'act-theme',group:'Actions',label:dark?'Passer au thème clair':'Passer au thème sombre',icon:dark?Sun:Moon,keywords:'apparence mode',run:()=>setDark(v=>!v)},
      {id:'act-mfa',group:'Actions',label:'Double authentification',icon:KeyRound,keywords:'mfa totp securite',run:()=>go('security')},
      {id:'act-logout',group:'Actions',label:'Se déconnecter',icon:LogOut,run:()=>void logout()},
      ...(inventory?.accounts||[]).filter(a=>a.managed).slice(0,300).map(a=>({id:'cl-'+a.id,group:'Clients',label:a.label,hint:a.username,icon:Users,keywords:a.resellerName,run:()=>{go('clients');setOpenClient({id:a.id,n:Date.now()})}})),
      ...resellers.slice(0,300).map(r=>({id:'rs-'+r.id,group:'Revendeurs',label:r.name,hint:r.email,icon:CreditCard,run:()=>go('resellers')})),
    ];
  },[user,inventory,resellers,dark]);

  if(!checked)return <div className="login-loading">Chargement sécurisé…</div>;
  if(!user)return <div className="login-shell">
    <section className="login-aside" aria-hidden="true">
      <div className="login-brand"><Logo/><div><div className="brand-title">ABESS VPN</div><div className="brand-subtitle">Centre de gestion SSH-WSS</div></div></div>
      <div>
        <h2>Vendez, gérez et supervisez vos accès <em>SSH-WSS</em> depuis un seul espace.</h2>
        <div className="login-features">
          <div><Users size={15}/><p><strong>Clients en temps réel</strong><span>Quotas, sessions, expirations</span></p></div>
          <div><CreditCard size={15}/><p><strong>Réseau de revendeurs</strong><span>Multi-niveaux et crédits</span></p></div>
          <div><ReceiptText size={15}/><p><strong>Facturation</strong><span>MoMo, Orange Money, factures</span></p></div>
          <div><Shield size={15}/><p><strong>Sécurité</strong><span>MFA, sessions, journal d’audit</span></p></div>
        </div>
        <p className="login-legal">Accès réservé aux administrateurs et revendeurs autorisés.</p>
      </div>
    </section>
    <main className="login-main"><div className="login-card">
      <h1>Bienvenue</h1><p>Connectez-vous au centre de gestion sécurisé.</p>
      {authError&&<p className="notice" role="alert" style={{marginBottom:12}}>{authError}</p>}
      <form className="login-form" onSubmit={login}>
        <label className="field-block"><span className="field-label">Adresse email</span><input className="field" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@exemple.com"/></label>
        <div className="field-block"><label className="field-label" htmlFor="login-password">Mot de passe</label>
          <div className="password-wrap"><input id="login-password" className="field" type={showPassword?'text':'password'} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/>
            <button type="button" aria-label={showPassword?'Masquer le mot de passe':'Afficher le mot de passe'} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={15}/>:<Eye size={15}/>}</button></div></div>
        {mfa&&<label className="field-block"><span className="field-label">Code de double authentification</span><input className="field mono" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value)} placeholder="123 456"/></label>}
        <button className="btn btn-primary" style={{width:'100%',marginTop:4}} disabled={busy}>{busy?'Connexion…':'Se connecter'}</button>
      </form>
    </div></main>
  </div>;

  const nav:{group:string;items:{id:Tab;label:string;icon:typeof Users;badge?:number;alert?:boolean}[]}[]=[
    {group:'Pilotage',items:[{id:'dashboard',label:'Tableau de bord',icon:ChartNoAxesCombined}]},
    {group:'Commerce',items:[
      {id:'clients',label:'Clients',icon:Users,badge:(inventory?.accounts||[]).filter(a=>a.managed).length},
      {id:'resellers',label:'Revendeurs',icon:CreditCard,badge:resellers.length||undefined},
      {id:'billing',label:'Facturation',icon:ReceiptText},
      {id:'transactions',label:'Transactions',icon:History},
    ]},
    ...(user.role==='SUPER_ADMIN'?[{group:'Administration',items:[
      {id:'servers' as Tab,label:'Serveurs',icon:Server,badge:(inventory?.managedNodes||[]).filter(n=>!n.agentOnline).length||undefined,alert:true},
      {id:'audit' as Tab,label:'Journal d’audit',icon:FileSearch},
      {id:'team' as Tab,label:'Équipe',icon:UserCog},
    ]}]:[]),
    {group:'Compte',items:[{id:'security',label:'Sécurité',icon:Shield}]},
  ];
  const people=new Map<string,string>([[user.id,user.name],...resellers.map(r=>[r.id,r.name] as [string,string]),...operators.map(o=>[o.id,o.name] as [string,string])]);
  const serverNodes=(nodes.map(n=>({
    id:n.id,name:n.name,host:n.host,sni:n.sshWsSni||n.host,port:n.sshWsPort||443,path:n.sshWsPath||'/ssh-ws',
    agentOnline:Boolean(n.sshWsAgentSeenAt&&Date.now()-Date.parse(n.sshWsAgentSeenAt)<60000),hostTelemetry:n.sshWsHost||null,enabled:n.enabled,sshWsManaged:n.sshWsManaged,sshWsAgentSeenAt:n.sshWsAgentSeenAt
  })) as any[]);

  return <div className={'panel-shell'+(collapsed?' collapsed':'')}>
    {mobileOpen&&<div className="drawer-backdrop" style={{zIndex:35}} onClick={()=>setMobileOpen(false)}/>}
    <aside className={'sidebar '+(mobileOpen?'mobile-open':'')}>
      <div className="brand-lockup"><Logo/><div><div className="brand-title">ABESS VPN</div><div className="brand-subtitle">SSH-WSS ONLY</div></div></div>
      {nav.map(section=><div key={section.group}>
        <div className="nav-section-label">{section.group}</div>
        <nav className="side-nav">{section.items.map(item=><button key={item.id} title={collapsed?item.label:undefined} aria-current={tab===item.id?'page':undefined} className={'nav-button '+(tab===item.id?'active':'')} onClick={()=>go(item.id)}>
          <item.icon size={16}/><span className="nav-text">{item.label}</span>{item.badge!==undefined&&<span className={'nav-badge'+(item.alert?' alert':'')}>{item.badge}</span>}
        </button>)}</nav>
      </div>)}
      <div className="sidebar-footer">
        <div className="user-mini"><div className="avatar">{user.name.slice(0,1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{roleLabel[user.role]}{user.role==='RESELLER'?' · '+Number(user.credits||0).toFixed(2)+' Go':''}</span></div></div>
        <div className="sidebar-actions">
          <button className="icon-button ghost" aria-label="Changer le thème" title="Thème" onClick={()=>setDark(v=>!v)}>{dark?<Sun size={15}/>:<Moon size={15}/>}</button>
          <button className="icon-button ghost collapse-toggle" aria-label={collapsed?'Déplier la barre latérale':'Replier la barre latérale'} title="Replier" onClick={()=>setCollapsed(v=>!v)}>{collapsed?<PanelLeftOpen size={15}/>:<PanelLeftClose size={15}/>}</button>
          <button className="icon-button ghost" aria-label="Se déconnecter" title="Se déconnecter" onClick={()=>void logout()}><LogOut size={15}/></button>
        </div>
      </div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu" aria-label="Ouvrir le menu" onClick={()=>setMobileOpen(true)}><Menu size={16}/></button>
          <div className="crumbs"><span className="crumb-root">{sections[tab]}</span><ChevronRight size={13} className="crumb-sep"/><span className="topbar-title">{titles[tab]}</span></div>
          {lastSync&&<span className="sync-hint"><span className="sync-dot"/>Synchronisé {lastSync.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>}
        </div>
        <div className="top-actions">
          <button className="cmdk-trigger" onClick={()=>setPaletteOpen(true)} aria-label="Rechercher"><Search size={14}/><span>Rechercher…</span><kbd>Ctrl K</kbd></button>
          <button className="icon-button" title="Actualiser" aria-label="Actualiser" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={15} className={loading?'animate-spin':''}/></button>
          <div className="notification-trigger"><button className="icon-button" aria-label="Notifications" onClick={()=>setNotificationsOpen(v=>!v)}><Bell size={15}/>{notifications.length>0&&<span className="notification-count">{notifications.length}</span>}</button>
            {notificationsOpen&&<div className="notification-popover"><div className="np-head"><h2>Notifications</h2><span className="badge badge-neutral plain">{notifications.length}</span></div>
              <div className="alert-list">{notifications.length?notifications.map((n,i)=><button key={i} className="alert-row" onClick={()=>go(n.tab)}><span className="alert-dot" style={{background:n.tone==='danger'?'var(--danger)':n.tone==='warning'?'var(--warning)':'var(--info)'}}/><div><p>{n.title}</p><span>{n.detail}</span></div><ChevronRight size={14} color="var(--muted)"/></button>):<div className="empty-state"><Bell size={20}/><strong>Tout est calme</strong><span>Aucun élément à surveiller.</span></div>}</div>
            </div>}
          </div>
          <button className="btn btn-primary topbar-cta" onClick={newClient}><Plus size={14}/><span>Nouveau client</span></button>
        </div>
      </header>

      <main className="main-content">
        {notice&&<p className="notice" role="alert" style={{marginBottom:12}}>{notice}</p>}
        {tab==='dashboard'&&<Dashboard inventory={inventory} transactions={transactions} resellers={resellers} audit={audit} ops={ops} role={user.role} user={user} onNavigate={go} onCreateClient={newClient}/>}
        {tab==='clients'&&<SshCenter inventory={inventory} resellers={resellers} role={user.role} audit={audit} currentUser={user} request={request} refresh={refresh} createSignal={createSignal} openClient={openClient}/>}
        {tab==='resellers'&&<ResellerCenter resellers={resellers} accounts={(inventory?.accounts||[]).filter(a=>a.managed)} transactions={transactions} busy={busy} currentUser={user} request={request} refresh={refresh} onOpenClient={id=>{go('clients');setOpenClient({id,n:Date.now()})}}/>}
        {tab==='billing'&&<BillingCenter currentUser={user} role={user.role} request={request} onCreditsChanged={refresh}/>}
        {tab==='transactions'&&<TransactionsCenter transactions={transactions}/>}
        {tab==='audit'&&user.role==='SUPER_ADMIN'&&<AuditCenter audit={audit} people={people}/>}
        {tab==='servers'&&user.role==='SUPER_ADMIN'&&<ServerCenter nodes={serverNodes} ops={ops} audit={audit} busy={busy} request={request} refresh={refresh}/>}
        {tab==='security'&&<div className="stack"><div className="page-header"><div><h1>Sécurité</h1><p>Double authentification, mot de passe et sessions actives.</p></div></div><SecurityCenter request={request} onLogout={()=>void logout()}/></div>}
        {tab==='team'&&user.role==='SUPER_ADMIN'&&<TeamCenter operators={operators} busy={busy} request={request} refresh={refresh}/>}
      </main>
    </div>
    <CommandPalette open={paletteOpen} onClose={()=>setPaletteOpen(false)} commands={commands}/>
  </div>;
}

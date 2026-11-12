import {useEffect,useState,type FormEvent} from 'react';
import {Terminal,Shield,Server,Users,LogOut,RefreshCw,Sun,Moon,History,Download} from 'lucide-react';
import {SshCenter} from './components/SshCenter';
import {SecurityCenter} from './components/SecurityCenter';

type User={id:string,name:string,email:string,role:'SUPER_ADMIN'|'RESELLER',credits:number};
type Tab='ssh'|'resellers'|'ledger'|'security'|'operations';
type Reseller={id:string,name:string,email:string,credits:number,status:string};
type Transaction={id:string,resellerName:string,type:string,amountGb:number,balanceBefore:number,balanceAfter:number,note:string,timestamp:string};
type Node={id:string,name:string,host:string,enabled:boolean,sshWsManaged?:boolean,sshWsAgentSeenAt?:string};
const headings:Record<Tab,string>={ssh:'Comptes SSH-WSS',resellers:'Revendeurs et crédits',ledger:'Registre des crédits',security:'Sécurité',operations:'État des serveurs'};
const validRecent=(value?:string)=>Boolean(value&&Number.isFinite(Date.parse(value))&&Math.abs(Date.now()-Date.parse(value))<60000);

export default function App(){
  const [user,setUser]=useState<User|null>(null);
  const [checked,setChecked]=useState(false);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [code,setCode]=useState('');
  const [mfa,setMfa]=useState(false);
  const [authError,setAuthError]=useState('');
  const [busy,setBusy]=useState(false);
  const [tab,setTab]=useState<Tab>('ssh');
  const [dark,setDark]=useState(()=>localStorage.getItem('abess_panel_theme')==='dark');
  const [resellers,setResellers]=useState<Reseller[]>([]);
  const [ledger,setLedger]=useState<Transaction[]>([]);
  const [nodes,setNodes]=useState<Node[]>([]);
  const [ops,setOps]=useState<any>(null);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const [newName,setNewName]=useState('');
  const [newEmail,setNewEmail]=useState('');
  const [newPass,setNewPass]=useState('');
  const [newCredit,setNewCredit]=useState(0);
  const [creditAmounts,setCreditAmounts]=useState<Record<string,string>>({});
  const token='cookie-session'; // session secret stays in an HttpOnly cookie
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  useEffect(()=>{
    localStorage.removeItem('abess_admin_token');
    localStorage.removeItem('abess_admin_user');
    fetch('/api/v1/auth/me').then(async res=>{
      if(res.ok)setUser(await res.json());
    }).catch(()=>{}).finally(()=>setChecked(true));
  },[]);
  useEffect(()=>{
    localStorage.setItem('abess_panel_theme',dark?'dark':'light');
    document.documentElement.classList.toggle('theme-light',!dark);
    document.body.classList.toggle('theme-light',!dark);
  },[dark]);
  async function req(url:string,method='GET',body?:unknown){
    const res=await fetch(url,{method,credentials:'same-origin',headers,body:body===undefined?undefined:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(data.error||'Opération indisponible');
    return data;
  }
  async function login(e:FormEvent){
    e.preventDefault();setBusy(true);setAuthError('');
    try{
      const data=await req('/api/v1/auth/login','POST',{email,password,code:code.trim()});
      if(data.success&&data.user){
        setUser(data.user);setTab('ssh');setPassword('');setCode('');setMfa(false);
      }else{if(data.mfaRequired)setMfa(true);setAuthError(data.error||'Accès refusé');}
    }catch(e){
      const text=e instanceof Error?e.message:'Connexion indisponible';
      if(/double authentification|mfa|code/i.test(text))setMfa(true);
      setAuthError(text);
    }finally{setBusy(false)}
  }
  async function logout(){
    try{await req('/api/v1/auth/logout','POST',{})}catch{}
    setUser(null);setTab('ssh');setResellers([]);setLedger([]);setNodes([]);setOps(null);
  }
  async function refresh(){
    if(!user)return;
    setLoading(true);setNotice('');
    try {
      const requests=[req('/api/v1/admin/resellers'),req('/api/v1/admin/transactions'),...(user.role==='SUPER_ADMIN'?
        [req('/api/v1/admin/nodes'),req('/api/v1/admin/operations')]:[])];
      const result=await Promise.all(requests);
      setResellers(result[0]);
      setLedger(result[1]);
      if(user.role==='SUPER_ADMIN'){setNodes(result[2]);setOps(result[3]);}
      const me=await req('/api/v1/auth/me');setUser(me);
    }catch(e){setNotice((e as Error).message);}
    finally{setLoading(false)}
  }
  useEffect(()=>{if(user)void refresh()},[user?.id]);
  async function mutate(work:()=>Promise<unknown>){
    setBusy(true);setNotice('');
    try{await work();await refresh();}
    catch(e){setNotice((e as Error).message)}
    finally{setBusy(false)}
  }
  if(!checked)return <div className="min-h-screen bg-slate-950 text-white grid place-items-center">Connexion sécurisée au panneau SSH-WSS…</div>;
  if(!user)return <div className="min-h-screen bg-[#060b16] text-slate-100 grid place-items-center p-5">
    <div className="w-full max-w-md bg-slate-900 border border-emerald-800/50 rounded-3xl p-7 space-y-5">
      <div className="flex items-center gap-3 text-emerald-400"><Terminal size={27}/><strong>ABESS VPN · SSH-WSS</strong></div>
      <h1 className="text-2xl font-bold">Connexion au panneau</h1>
      <p className="text-sm text-slate-400">Un seul protocole client : SSH par WebSocket sécurisé (TLS).</p>
      {authError&&<p role="alert" className="text-rose-300 bg-rose-950/30 rounded-xl p-3">{authError}</p>}
      <form onSubmit={login} className="space-y-4">
        <label className="block text-sm">Adresse email
          <input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}
            className="w-full bg-slate-950 rounded-xl border border-slate-700 p-3 mt-1"/>
        </label>
        <label className="block text-sm">Mot de passe
          <input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}
            className="w-full bg-slate-950 rounded-xl border border-slate-700 p-3 mt-1"/>
        </label>
        {mfa&&<label className="block text-sm">Code de double authentification
          <input required autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}
            className="w-full bg-slate-950 rounded-xl border border-slate-700 p-3 mt-1"/>
        </label>}
        <button disabled={busy} className="bg-emerald-500 text-slate-950 font-bold rounded-xl px-4 py-3 w-full disabled:opacity-50">
          {busy?'Connexion…':'Se connecter'}
        </button>
      </form>
    </div>
  </div>;
  const tabs:{id:Tab,label:string,icon:typeof Terminal}[]=[
    {id:'ssh',label:'SSH-WSS',icon:Terminal},
    {id:'resellers',label:'Revendeurs & crédits',icon:Users},
    {id:'ledger',label:'Registre',icon:History},
    {id:'security',label:'Sécurité',icon:Shield},
    ...(user.role==='SUPER_ADMIN'?[{id:'operations' as Tab,label:'Serveurs',icon:Server}]:[])
  ];
  return <div className="min-h-screen bg-[#060b16] text-slate-100">
    <header className="sticky top-0 z-20 bg-[#080e1d]/95 border-b border-slate-700/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center"><Terminal className="text-emerald-400"/>
          <strong>ABESS VPN</strong><span className="text-emerald-400 text-xs border border-emerald-700 rounded px-2 py-1">SSH-WSS uniquement</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">{user.name} · {Number(user.credits||0).toFixed(2)} Go</span>
          <button aria-label="Basculer le thème" onClick={()=>setDark(v=>!v)}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button>
          <button onClick={()=>void logout()} className="flex items-center gap-1 border border-slate-700 rounded-lg px-3 py-2"><LogOut size={15}/>Déconnexion</button>
        </div>
      </div>
      <nav aria-label="Navigation principale" className="max-w-6xl mx-auto px-4 py-2 flex gap-2 overflow-x-auto">
        {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} aria-current={tab===t.id?'page':undefined}
          className={'rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap flex items-center gap-2 '+(tab===t.id?'bg-emerald-950 text-emerald-300 border border-emerald-600':'text-slate-400 border border-transparent')}>
          <t.icon size={16}/>{t.label}
        </button>)}
      </nav>
    </header>
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold">{headings[tab]}</h1><p className="text-xs text-slate-400">VPS géré · TLS/WSS 443 · quotas et sessions serveur</p></div>
        <button onClick={()=>void refresh()} disabled={loading} className="text-emerald-400 flex items-center gap-2 text-sm"><RefreshCw size={16}/>{loading?'Actualisation…':'Actualiser'}</button>
      </div>
      {notice&&<p role="alert" className="rounded-lg bg-rose-950/40 text-rose-200 p-3">{notice}</p>}
      {tab==='ssh'&&<SshCenter token={token} isAdmin={user.role==='SUPER_ADMIN'}/>}
      {tab==='security'&&<SecurityCenter token={token} onLogout={()=>void logout()}/>}
      {tab==='resellers'&&<div className="space-y-5">
        <form onSubmit={e=>{e.preventDefault();void mutate(async()=>{await req('/api/v1/admin/resellers','POST',{name:newName,email:newEmail,password:newPass,initialCredits:newCredit});setNewName('');setNewEmail('');setNewPass('');setNewCredit(0);});}}
          className="rounded-xl p-5 border border-slate-700 space-y-3">
          <h2 className="font-bold text-emerald-300">Créer un revendeur SSH-WSS</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <input required aria-label="Nom du revendeur" placeholder="Nom" value={newName} onChange={e=>setNewName(e.target.value)} className="bg-slate-950 p-3 rounded-lg"/>
            <input required aria-label="Email du revendeur" type="email" placeholder="Email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} className="bg-slate-950 p-3 rounded-lg"/>
            <input required aria-label="Mot de passe du revendeur" type="password" minLength={12} placeholder="Mot de passe" value={newPass} onChange={e=>setNewPass(e.target.value)} className="bg-slate-950 p-3 rounded-lg"/>
            <label className="text-xs text-slate-400">Crédits de départ (Go)
              <input aria-label="Crédits de départ" type="number" min={0} step={0.01} value={newCredit} onChange={e=>setNewCredit(Number(e.target.value))} className="bg-slate-950 p-3 rounded-lg w-full"/>
            </label>
          </div>
          <button disabled={busy} className="bg-emerald-500 text-slate-950 font-bold px-4 py-2 rounded-lg">Créer le revendeur</button>
        </form>
        <div className="rounded-xl p-5 border border-slate-700 overflow-x-auto"><h2 className="font-bold mb-4">Revendeurs actifs et soldes</h2>
          <table className="w-full text-sm"><thead><tr className="text-left text-slate-400"><th>Revendeur</th><th>Solde</th><th>État</th><th>Recharge en Go</th></tr></thead><tbody>
            {resellers.map(x=><tr key={x.id} className="border-t border-slate-800"><td className="py-3">{x.name}<p className="text-xs text-slate-500">{x.email}</p></td><td>{x.credits} Go</td><td>{x.status}</td>
              <td><div className="flex gap-2"><input type="number" min={0.01} step={0.01} value={creditAmounts[x.id]||''} onChange={e=>setCreditAmounts(v=>({...v,[x.id]:e.target.value}))}
                aria-label={'Recharge de '+x.name} className="bg-slate-950 rounded-lg p-2 w-24"/>
                <button type="button" disabled={busy||Number(creditAmounts[x.id])<=0} className="border border-emerald-700 rounded-lg px-3"
                  onClick={()=>void mutate(async()=>{await req('/api/v1/admin/resellers/'+x.id+'/credit','PUT',{amount:Number(creditAmounts[x.id])});setCreditAmounts(v=>({...v,[x.id]:''}));})}>Créditer</button></div></td></tr>)}
          </tbody></table>
        </div>
      </div>}
      {tab==='ledger'&&<section className="rounded-xl border border-slate-700 p-5 overflow-x-auto">
        <h2 className="font-semibold mb-3">Historique commercial des crédits SSH-WSS</h2>
        <p className="text-xs text-slate-400 mb-4">Ce registre historique est conservé pour l'audit des mouvements de crédits, même s'ils proviennent de l'ancienne version.</p>
        <table className="w-full text-sm text-left"><thead className="text-slate-400"><tr><th className="p-2">Date</th><th className="p-2">Revendeur</th><th className="p-2">Action</th><th className="p-2">Go</th><th className="p-2">Solde après</th></tr></thead>
        <tbody>{ledger.map(x=><tr key={x.id} className="border-t border-slate-800"><td className="p-2">{new Date(x.timestamp).toLocaleString('fr-FR')}</td>
          <td className="p-2">{x.resellerName}</td><td className="p-2">{x.type}<p className="text-xs text-slate-400">{x.note}</p></td>
          <td className="p-2">{x.amountGb}</td><td className="p-2">{x.balanceAfter}</td></tr>)}</tbody></table>
      </section>}
      {tab==='operations'&&user.role==='SUPER_ADMIN'&&<div className="space-y-5">
        <div className="rounded-xl border border-slate-700 p-5"><h2 className="font-bold mb-3">Agents SSH-WSS</h2>
          {nodes.filter(n=>n.sshWsManaged).map(n=><div key={n.id} className="border-t border-slate-800 py-3 flex flex-wrap justify-between gap-2">
            <span>{n.name}<span className="block text-xs text-slate-400">{n.host}</span></span>
            <span className={validRecent(n.sshWsAgentSeenAt)?'text-emerald-400':'text-amber-400'}>{validRecent(n.sshWsAgentSeenAt)?'Agent connecté':'Agent non connecté'}</span>
          </div>)}
        </div>
        <div className="rounded-xl border border-slate-700 p-5 space-y-2"><h2 className="font-bold">Sauvegarde des données</h2>
          <p className="text-sm text-slate-400">Sauvegarde chiffrée avant tout nettoyage des anciennes données.</p>
          <button className="flex items-center gap-2 text-emerald-300 border border-emerald-700 rounded-lg px-3 py-2"
            onClick={()=>void mutate(async()=>{
              const dump=await req('/api/v1/admin/operations/backup');
              const url=URL.createObjectURL(new Blob([JSON.stringify(dump)],{type:'application/json'}));
              const a=document.createElement('a');a.href=url;a.download='abess-archive-chiffree.json';a.click();URL.revokeObjectURL(url);
            })}><Download size={16}/>Télécharger une sauvegarde chiffrée</button>
        </div>
        <div className="rounded-xl border border-slate-700 p-5"><h2 className="font-bold mb-3">Santé de l’API</h2>
          <p>Base : {ops?.storage||'—'} · Disque disponible : {ops?.freeBytes? (ops.freeBytes/1024**3).toFixed(1)+' Go':'—'}</p>
          <p className="text-sm text-slate-400 mt-2">Les alertes générales de l’ancien moteur Xray ne représentent pas le statut SSH-WSS.</p>
        </div>
      </div>}
    </main>
  </div>;
}

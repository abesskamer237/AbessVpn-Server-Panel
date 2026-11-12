import {useEffect,useState,type FormEvent} from 'react';
import {Copy,Download,RefreshCw,Terminal,Trash2} from 'lucide-react';

type Node={id:string,name:string,host:string,sni?:string,port:number,path:string,agentOnline:boolean};
type Account={id:string,username:string,label:string,nodeId:string,managed:boolean,
 provisionState:string,enabled:boolean,expiresAt:string,quotaBytes:number,usedBytes:number|null,
 online:number|null,maxConnections:number,trafficVerified:boolean,effectiveEnabled:boolean,
 connection?:{host:string,transport:string,port:number}};
type SshInventory={managedNodes:Node[],accounts:Account[],sshWsReady:boolean};
type ExportData={username:string,password:string,path:string,sni:string,host:string,port:number,fingerprint:string,wire:string,transport:string};
const gb=(b:number)=>Number(b/1024**3).toFixed(2);

export function SshCenter({token,isAdmin=true}:{token:string,isAdmin?:boolean}){
  const [inventory,setInventory]=useState<SshInventory|null>(null);
  const [nodeId,setNodeId]=useState('');
  const [label,setLabel]=useState('');
  const [days,setDays]=useState(30);
  const [quotaGb,setQuotaGb]=useState(10);
  const [maxConnections,setMaxConnections]=useState(1);
  const [selected,setSelected]=useState('');
  const [config,setConfig]=useState<ExportData|null>(null);
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [renewId,setRenewId]=useState('');
  const [additionalGb,setAdditionalGb]=useState(1);
  const [additionalDays,setAdditionalDays]=useState(30);
  const [resellerId,setResellerId]=useState('');
  const [resellers,setResellers]=useState<Array<{id:string,name:string}>>([]);
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  async function request(uri:string,method='GET',body?:unknown,extraHeaders?:Record<string,string>){
    const res=await fetch('/api/v1/admin/ssh'+uri,{method,headers:{...headers,...extraHeaders},credentials:'same-origin',
      body:body===undefined?undefined:JSON.stringify(body)});
    const value=res.status===204?{}:await res.json().catch(()=>({}));
    if(!res.ok)throw Error(value.error||'Opération SSH-WSS refusée');
    return value;
  }
  async function refresh(){
    const data:SshInventory=await request('');
    setInventory(data);
    setNodeId(prev=>data.managedNodes.some(n=>n.id===prev)?prev:
      (data.managedNodes.find(n=>n.agentOnline)||data.managedNodes[0])?.id||'');
    if(isAdmin){
      const response=await fetch('/api/v1/admin/resellers',{headers});
      if(response.ok)setResellers(await response.json());
    }
  }
  useEffect(()=>{void refresh().catch(e=>setError(e.message));
    const timer=setInterval(()=>void refresh().catch(e=>setError(e.message)),10000);
    return()=>clearInterval(timer);
  },[token]);
  async function run(fn:()=>Promise<void>){
    setBusy(true);setError('');
    try{await fn();await refresh()}catch(e){setError((e as Error).message)}
    finally{setBusy(false)}
  }
  async function create(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      const created=await request('/managed','POST',{
        nodeId,label:label.trim()||'Client SSH-WSS',days,quotaGb,maxConnections,
        ...(isAdmin&&resellerId?{resellerId}:{})
      });
      setSelected(created.id);setConfig(null);setLabel('');
    });
  }
  const node=inventory?.managedNodes.find(n=>n.id===nodeId);
  const account=inventory?.accounts.find(a=>a.id===selected);
  function download(){
    if(!config)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='abess-ssh-wss-'+config.username+'.json';a.click();URL.revokeObjectURL(url);
  }
  return <section aria-label="Comptes SSH-WSS" className="space-y-5">
    <div className="rounded-xl p-5 border border-emerald-800/50 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold flex gap-2 items-center text-emerald-300"><Terminal size={20}/>Moteur SSH sur WebSocket sécurisé (WSS)</h2>
        <p className="text-xs text-slate-400 mt-1">Un seul protocole · TLS 443 · authentification SSH · quotas serveur</p></div>
      <span className={inventory?.sshWsReady?'text-emerald-400':'text-amber-400'}>
        {inventory?.sshWsReady?'● Agent SSH-WSS connecté':'● Agent SSH-WSS non connecté'}
      </span>
      <button disabled={busy} onClick={()=>void run(refresh)} className="text-sm text-cyan-300 flex gap-2 items-center"><RefreshCw size={16}/>Actualiser</button>
    </div>
    {error&&<p role="alert" className="bg-rose-950/30 border border-rose-900 rounded-lg p-3 text-rose-300">{error}</p>}
    <div className="rounded-xl border border-slate-700 p-5 space-y-2">
      <h3 className="font-semibold">Serveur VPS</h3>
      {!inventory?.managedNodes.length&&<p className="text-amber-400">Aucun serveur autorisé pour SSH-WSS. L'administrateur doit enregistrer un nœud depuis l'API d'exploitation.</p>}
      {inventory?.managedNodes.map(n=><div key={n.id} className="flex flex-wrap gap-3 items-center justify-between border-t border-slate-800 py-2 text-sm">
        <div><strong>{n.name}</strong><p className="text-slate-400 text-xs">{n.sni||n.host}:{n.port} {n.path}</p></div>
        <span className={n.agentOnline?'text-emerald-400':'text-amber-400'}>{n.agentOnline?'Agent connecté':'Agent hors ligne'}</span>
      </div>)}
    </div>
    <form onSubmit={e=>void create(e)} className="rounded-xl border border-emerald-800/50 p-5 space-y-4">
      <h3 className="font-semibold text-emerald-300">Créer un client SSH-WSS</h3>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <label className="text-xs col-span-2">Serveur administré
          <select aria-label="Serveur administré SSH-WSS" value={nodeId} onChange={e=>setNodeId(e.target.value)}
            className="block mt-1 w-full bg-slate-950 rounded-lg p-3">
            <option value="">Choisir un serveur</option>
            {inventory?.managedNodes.map(n=><option key={n.id} value={n.id}>{n.name} · {n.agentOnline?'en ligne':'hors ligne'}</option>)}
          </select>
        </label>
        <label className="text-xs col-span-2">Client
          <input aria-label="Nom du client SSH-WSS" value={label} maxLength={80} onChange={e=>setLabel(e.target.value)}
            className="block mt-1 w-full bg-slate-950 rounded-lg p-3"/>
        </label>
        <label className="text-xs">Durée (jours)
          <input type="number" min={1} max={366} required value={days} onChange={e=>setDays(Number(e.target.value))}
            className="block mt-1 w-full bg-slate-950 rounded-lg p-3"/>
        </label>
        <label className="text-xs">Quota (Go)
          <input type="number" min={0.01} max={100000} step={0.01} required value={quotaGb} onChange={e=>setQuotaGb(Number(e.target.value))}
            className="block mt-1 w-full bg-slate-950 rounded-lg p-3"/>
        </label>
        <label className="text-xs">Sessions simultanées
          <input type="number" min={1} max={10} required value={maxConnections} onChange={e=>setMaxConnections(Number(e.target.value))}
            className="block mt-1 w-full bg-slate-950 rounded-lg p-3"/>
        </label>
        {isAdmin&&<label className="text-xs col-span-2">Revendeur propriétaire
          <select value={resellerId} onChange={e=>setResellerId(e.target.value)} aria-label="Revendeur propriétaire SSH-WSS"
            className="block mt-1 w-full bg-slate-950 rounded-lg p-3"><option value="">Compte administrateur</option>
            {resellers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>}
      </div>
      <button disabled={busy||!node?.agentOnline} className="bg-emerald-500 text-slate-950 px-5 py-3 rounded-lg font-bold disabled:opacity-40">
        {busy?'Traitement…':'Créer le compte SSH-WSS'}
      </button>
      <p className="text-xs text-slate-400">Les identifiants ne sont exportables qu'après confirmation de la création du compte Linux par l'agent. La limite concerne les sessions WSS, pas les canaux SSH internes.</p>
    </form>
    <div className="rounded-xl border border-slate-700 p-5 space-y-3">
      <div className="flex flex-wrap justify-between gap-2 items-center"><h3 className="font-semibold">Comptes SSH-WSS</h3>
        <input aria-label="Rechercher un compte SSH-WSS" type="search" placeholder="Rechercher un client…" value={search} onChange={e=>setSearch(e.target.value)}
          className="bg-slate-950 rounded-lg p-3 border border-slate-800"/>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-slate-400"><tr>
        <th className="p-2">Client</th><th className="p-2">État</th><th className="p-2">Trafic / quota</th>
        <th className="p-2">Sessions</th><th className="p-2">Expiration</th><th className="p-2">Actions</th>
      </tr></thead><tbody>
        {(inventory?.accounts||[]).filter(a=>a.managed&&[a.username,a.label].join(' ').toLowerCase().includes(search.toLowerCase())).map(a=><tr key={a.id} className="border-t border-slate-800">
          <td className="p-2"><strong>{a.username}</strong><div className="text-xs text-slate-400">{a.label}</div></td>
          <td className="p-2">{!a.enabled?'Suspendu':a.provisionState==='pending'?'Création VPS…':a.provisionState==='error'?'Erreur VPS':a.effectiveEnabled?'Actif':'Inactif'}</td>
          <td className="p-2">{a.usedBytes===null?'—':gb(a.usedBytes)} / {gb(a.quotaBytes)} Go</td>
          <td className="p-2">{a.online??'—'} / {a.maxConnections}</td>
          <td className="p-2">{new Date(a.expiresAt).toLocaleDateString('fr-FR')}</td>
          <td className="p-2"><div className="flex flex-wrap gap-2">
            <button className="text-emerald-300" type="button" onClick={()=>{setSelected(a.id);setConfig(null)}}>Configurer</button>
            <button className="text-cyan-300" type="button" onClick={()=>setRenewId(a.id)}>Renouveler</button>
            <button className="text-amber-300" type="button" disabled={busy}
              onClick={()=>void run(async()=>{await request('/accounts/'+a.id,'PATCH',{enabled:!a.enabled});setConfig(null)})}>
              {a.enabled?'Suspendre':'Réactiver'}
            </button>
            {isAdmin&&<button aria-label={'Supprimer '+a.username} type="button" disabled={busy} className="text-rose-400"
              onClick={()=>{if(confirm('Supprimer définitivement ce compte SSH-WSS ?'))void run(async()=>{await request('/accounts/'+a.id,'DELETE');if(selected===a.id){setSelected('');setConfig(null)}})}}><Trash2 size={16}/></button>}
          </div></td>
        </tr>)}
      </tbody></table></div>
    </div>
    {renewId&&<form className="rounded-xl border border-cyan-800 p-5 space-y-3"
      onSubmit={e=>{e.preventDefault();void run(async()=>{
        await request('/accounts/'+renewId+'/renew','POST',{additionalGb,days:additionalDays},{'Idempotency-Key':crypto.randomUUID().replaceAll('-','')});
        setRenewId('');
      })}}>
      <h3 className="font-semibold">Renouveler le compte</h3>
      <div className="flex flex-wrap gap-3"><label className="text-xs">Go supplémentaires
        <input aria-label="Go supplémentaires" type="number" min={0.01} step={0.01} value={additionalGb} onChange={e=>setAdditionalGb(Number(e.target.value))} className="block bg-slate-950 p-2 rounded"/>
      </label><label className="text-xs">Jours supplémentaires
        <input aria-label="Jours supplémentaires" type="number" min={1} max={366} value={additionalDays} onChange={e=>setAdditionalDays(Number(e.target.value))} className="block bg-slate-950 p-2 rounded"/>
      </label></div>
      <button disabled={busy} className="bg-cyan-600 rounded-lg px-4 py-2 font-semibold">Confirmer le renouvellement</button>
      <button type="button" onClick={()=>setRenewId('')} className="ml-3 text-slate-400">Annuler</button>
    </form>}
    {selected&&<div className="rounded-xl border border-slate-700 p-5 space-y-3">
      <h3 className="font-semibold">Identifiants et paramètres WSS {account?.username||''}</h3>
      <button disabled={busy||!account?.effectiveEnabled} className="bg-emerald-500 text-slate-950 font-bold p-3 rounded-lg disabled:opacity-40"
        onClick={()=>void run(async()=>{setConfig(await request('/accounts/'+selected+'/config','POST',{transport:'wss'}))})}>
        Afficher les identifiants SSH-WSS
      </button>
      {config&&<><pre className="text-xs p-4 bg-slate-950 border border-slate-800 rounded-lg overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(config,null,2)}</pre>
        <div className="flex gap-3 text-sm"><button type="button" onClick={()=>void navigator.clipboard.writeText(JSON.stringify(config,null,2))} className="flex gap-2 items-center"><Copy size={16}/>Copier</button>
        <button type="button" onClick={download} className="flex gap-2 items-center"><Download size={16}/>Exporter JSON</button>
        <button type="button" onClick={()=>setConfig(null)}>Masquer les secrets</button></div>
      </>}
      <p className="text-xs text-amber-300">La configuration contient un mot de passe SSH et un jeton WSS personnel. Ne la partagez qu’avec le client concerné.</p>
    </div>}
  </section>;
}

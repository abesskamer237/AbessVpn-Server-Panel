import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {BadgeDollarSign,Check,Copy,CornerDownRight,Download,Eye,EyeOff,KeyRound,Mail,MoreHorizontal,Network,Pause,Play,Plus,Search,Store,Tag,Trash2,UserPlus,Users,Wallet,Wand2,X} from 'lucide-react';
import type {Reseller,SshAccount,Transaction,User} from '../panelTypes';
import {accountStatus,bytesToGb,csvDownload,fmtDate,fmtDateTime,money} from '../panelTypes';

type Props={
  resellers:Reseller[];accounts:SshAccount[];transactions:Transaction[];busy:boolean;currentUser:User;
  request:(url:string,method?:string,body?:unknown)=>Promise<any>;
  refresh:()=>Promise<void>;onOpenClient?:(id:string)=>void;
};
type Row=Reseller&{clients:number;branchClients:number;active:number;soldGb:number;usedGb:number;revenue:number;margin:number};
type DrawerTab='overview'|'clients'|'ledger'|'settings';

const CHARS='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%+=._-';
const generatePassword=(n=18)=>Array.from(crypto.getRandomValues(new Uint32Array(n)),v=>CHARS[v%CHARS.length]).join('');
const CREDIT_PRESETS=[5,10,25,50,100];

export function ResellerCenter({resellers,accounts,transactions,busy,currentUser,request,refresh,onOpenClient}:Props){
  const isAdmin=currentUser.role==='SUPER_ADMIN'||currentUser.role==='ADMIN';
  const [createOpen,setCreateOpen]=useState(false),[parentId,setParentId]=useState('');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[showPw,setShowPw]=useState(false),[credits,setCredits]=useState(0);
  const [created,setCreated]=useState<{name:string;email:string;password:string}|null>(null);
  const [selectedId,setSelectedId]=useState(''),[tab,setTab]=useState<DrawerTab>('overview');
  const [creditAmount,setCreditAmount]=useState(''),[creditMode,setCreditMode]=useState<'add'|'remove'>('add'),[creditNote,setCreditNote]=useState('');
  const [priceGb,setPriceGb]=useState(0),[costGb,setCostGb]=useState(0),[priceLicence,setPriceLicence]=useState(0);
  const [editName,setEditName]=useState(''),[editEmail,setEditEmail]=useState(''),[newPassword,setNewPassword]=useState(''),[resetDone,setResetDone]=useState('');
  const [error,setError]=useState(''),[toast,setToast]=useState(''),[working,setWorking]=useState(false);
  const [search,setSearch]=useState(''),[status,setStatus]=useState<'all'|'active'|'suspended'|'low'>('all'),[sort,setSort]=useState<'tree'|'credits'|'clients'|'revenue'>('tree');

  useEffect(()=>{if(!toast)return;const t=window.setTimeout(()=>setToast(''),2600);return()=>window.clearTimeout(t)},[toast]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setCreateOpen(false);setSelectedId('')}};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[]);

  const rows=useMemo<Row[]>(()=>resellers.map(r=>{
    const mine=accounts.filter(a=>a.resellerId===r.id&&a.managed);
    const branchIds=new Set<string>([r.id]);const pending=[r.id];
    while(pending.length){const parent=pending.pop()!;for(const child of resellers)if(child.parentId===parent&&!branchIds.has(child.id)){branchIds.add(child.id);pending.push(child.id)}}
    const branch=accounts.filter(a=>a.resellerId&&branchIds.has(a.resellerId)&&a.managed);
    const soldGb=mine.reduce((n,a)=>n+bytesToGb(a.quotaBytes),0);
    const revenue=soldGb*(r.pricePerGbCfa||0)+mine.length*(r.pricePerLicenceCfa||0);
    return {...r,clients:mine.length,branchClients:branch.length,active:mine.filter(a=>a.effectiveEnabled).length,soldGb,usedGb:mine.reduce((n,a)=>n+bytesToGb(a.usedBytes),0),revenue,margin:revenue-soldGb*(r.costPerGbCfa||0)};
  }),[resellers,accounts]);

  const filtered=useMemo(()=>rows.filter(r=>{
    if(status==='active'&&r.status!=='active')return false;
    if(status==='suspended'&&r.status==='active')return false;
    if(status==='low'&&Number(r.credits)>=5)return false;
    return [r.name,r.email,r.parentName||'',...(r.hierarchyPath||[])].join(' ').toLowerCase().includes(search.toLowerCase());
  }).sort((a,b)=>sort==='credits'?Number(b.credits)-Number(a.credits):sort==='clients'?b.clients-a.clients:sort==='revenue'?b.revenue-a.revenue
    :(a.hierarchyPath||[a.name]).join(' / ').localeCompare((b.hierarchyPath||[b.name]).join(' / '),'fr')),[rows,search,status,sort]);

  const selected=rows.find(r=>r.id===selectedId)||null;
  useEffect(()=>{
    if(!selected)return;
    setEditName(selected.name);setEditEmail(selected.email);setNewPassword('');setResetDone('');setCreditAmount('');setCreditNote('');setCreditMode('add');
    setPriceGb(selected.pricePerGbCfa||0);setCostGb(selected.costPerGbCfa||0);setPriceLicence(selected.pricePerLicenceCfa||0);
  },[selectedId]);

  const totalCredits=resellers.reduce((n,r)=>n+Number(r.credits||0),0);
  const totalClients=accounts.filter(a=>a.managed&&resellers.some(r=>r.id===a.resellerId)).length;
  const totalRevenue=rows.reduce((n,r)=>n+r.revenue,0),totalMargin=rows.reduce((n,r)=>n+r.margin,0);
  const maxDepth=Math.max(0,...resellers.map(r=>Number(r.hierarchyDepth||0)));
  const directChildren=resellers.filter(r=>r.parentId===currentUser.id);
  const canManage=(r:Reseller)=>isAdmin||r.parentId===currentUser.id;
  const myCredits=Number(currentUser.credits||0);

  async function run(work:()=>Promise<void|string>){
    setWorking(true);setError('');
    try{const msg=await work();await refresh();if(typeof msg==='string')setToast(msg)}catch(e){setError(e instanceof Error?e.message:'Opération impossible')}
    finally{setWorking(false)}
  }
  function openCreate(parent?:Reseller){setParentId(isAdmin?(parent?.id||''):'');setCreated(null);setPassword(generatePassword());setShowPw(true);setCreateOpen(true);setError('')}
  async function create(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      await request('/api/v1/admin/resellers','POST',{name,email,password,initialCredits:credits,...(isAdmin&&parentId?{parentId}:{})});
      setCreated({name,email,password});
      setName('');setEmail('');setPassword('');setCredits(0);setParentId('');
      return 'Revendeur créé.';
    });
  }
  const copy=(text:string,msg:string)=>void navigator.clipboard?.writeText(text).then(()=>setToast(msg),()=>setError('Copie impossible : autorisez le presse-papiers.'));
  const accessMessage=(c:{name:string;email:string;password:string})=>`Bienvenue sur ABESS VPN, ${c.name} !\n\nAdresse : ${location.origin}\nEmail : ${c.email}\nMot de passe : ${c.password}\n\nChangez votre mot de passe et activez la double authentification dans « Sécurité » dès votre première connexion.`;
  const amount=Number(creditAmount)||0,signed=creditMode==='add'?amount:-amount;
  const clientsOf=(r:Reseller)=>accounts.filter(a=>a.resellerId===r.id&&a.managed).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const ledgerOf=(r:Reseller)=>transactions.filter(t=>t.resellerId===r.id).slice(0,40);
  const childrenOf=(r:Reseller)=>resellers.filter(x=>x.parentId===r.id);

  return <div className="stack">
    <div className="page-header"><div><h1>Revendeurs</h1><p>{isAdmin?'Réseau multi-niveaux, crédits, tarifs et performance commerciale.':'Votre réseau de sous-revendeurs : création, crédits, tarifs et suivi.'}</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>csvDownload('abess-revendeurs.csv',[
          ['Niveau','Chemin','Revendeur','Email','Parent','État','Solde Go','Clients directs','Descendants','CA estimé XAF','Marge estimée XAF'],
          ...rows.map(r=>[r.hierarchyDepth||0,(r.hierarchyPath||[r.name]).join(' > '),r.name,r.email,r.parentName||'',r.status,r.credits,r.clients,r.descendantCount||0,r.revenue,r.margin])
        ])}><Download size={14}/>CSV</button>
        <button className="btn btn-primary" onClick={()=>openCreate()}><Plus size={14}/>{isAdmin?'Nouveau revendeur':'Nouveau sous-revendeur'}</button>
      </div>
    </div>

    {!isAdmin&&<div className="balance-card">
      <div><div className="bc-label">Votre solde disponible</div><div className="bc-value">{myCredits.toFixed(2)} Go</div><div className="bc-label">Transférez des crédits à vos sous-revendeurs ou récupérez leurs crédits inutilisés.</div></div>
      <span className="badge badge-success">{directChildren.length} sous-revendeur(s) direct(s)</span>
    </div>}

    <div className="metric-grid">
      <div className="metric-card"><div className="metric-label"><Network size={13}/>Réseau visible</div><div className="metric-value">{resellers.length}</div><div className="metric-foot">{directChildren.length} direct(s) · profondeur {maxDepth}</div></div>
      <div className="metric-card"><div className="metric-label"><Users size={13}/>Clients du réseau</div><div className="metric-value">{totalClients}</div><div className="metric-foot">Licences SSH-WSS des branches</div></div>
      <div className="metric-card"><div className="metric-label"><BadgeDollarSign size={13}/>Crédits du réseau</div><div className="metric-value">{totalCredits.toFixed(1)} Go</div><div className="metric-foot">{rows.filter(r=>Number(r.credits)<5).length} solde(s) faible(s) &lt; 5 Go</div></div>
      <div className="metric-card"><div className="metric-label"><Store size={13}/>Marge estimée</div><div className="metric-value">{money(totalMargin)}</div><div className="metric-foot">CA estimé {money(totalRevenue)}</div></div>
    </div>

    {error&&<p className="notice" role="alert">{error}</p>}
    {toast&&<div className="toast" role="status"><Check size={14}/>{toast}</div>}

    <section className="card">
      <div className="panel-head" style={{flexWrap:'wrap'}}>
        <div className="search-wrap"><Search size={14}/><input className="search-input" placeholder="Nom, email, branche…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="filter-pills">{([['all','Tous'],['active','Actifs'],['suspended','Suspendus'],['low','Solde faible']] as const).map(([k,v])=><button key={k} className={'filter-pill '+(status===k?'active':'')} onClick={()=>setStatus(k)}>{v}</button>)}</div>
        <select className="select" style={{width:'auto',marginLeft:'auto'}} aria-label="Trier" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="tree">Arborescence</option><option value="credits">Solde</option><option value="clients">Clients</option><option value="revenue">CA estimé</option></select>
      </div>
      <div style={{overflow:'auto'}}><table className="data-table"><thead><tr>
        <th>Revendeur</th><th>Solde</th><th>Clients</th><th>Consommation</th><th>CA estimé</th><th>État</th><th style={{width:1}}></th>
      </tr></thead><tbody>{filtered.map(r=>{
        const depth=sort==='tree'?Math.max(0,Number(r.hierarchyDepth||0)-1):0;
        const manageable=canManage(r);
        return <tr key={r.id} className="clickable" onClick={()=>{setSelectedId(r.id);setTab('overview')}}>
          <td><div style={{display:'flex',alignItems:'center',gap:8,paddingLeft:Math.min(depth,6)*20}}>
            {depth>0&&<CornerDownRight size={13} color="var(--muted-2)"/>}
            <div className="avatar" style={{width:26,height:26,fontSize:11}}>{r.name.slice(0,1).toUpperCase()}</div>
            <div style={{minWidth:0}}><div className="table-primary">{r.name}</div><div className="table-secondary">{r.email}{r.parentName&&depth>0?' · sous '+r.parentName:''}</div></div>
          </div></td>
          <td className="num"><span className="table-primary" style={{color:Number(r.credits)<5?'var(--warning)':undefined}}>{Number(r.credits).toFixed(2)}</span> <span className="table-secondary">Go</span></td>
          <td className="num"><span className="table-primary">{r.active}</span><span className="table-secondary"> / {r.clients}</span>{(r.descendantCount||0)>0&&<div className="table-secondary">{r.descendantCount} sous-revendeur(s)</div>}</td>
          <td className="num">{r.usedGb.toFixed(1)} <span className="table-secondary">/ {r.soldGb.toFixed(1)} Go</span></td>
          <td className="num"><div className="table-primary">{money(r.revenue)}</div><div className="table-secondary">marge {money(r.margin)}</div></td>
          <td><span className={'badge '+(r.status==='active'?'badge-success':'badge-warning')}>{r.status==='active'?'Actif':'Suspendu'}</span></td>
          <td onClick={e=>e.stopPropagation()}><div className="row-actions">{manageable?<>
            <button className="btn btn-sm" disabled={working} onClick={()=>{setSelectedId(r.id);setTab('overview')}}><Wallet size={12}/>Crédits</button>
            <button className="icon-button ghost" style={{width:27,height:27}} title="Tarifs" aria-label={'Tarifs '+r.name} onClick={()=>{setSelectedId(r.id);setTab('settings')}}><Tag size={13}/></button>
            {isAdmin&&<button className="icon-button ghost" style={{width:27,height:27}} title="Créer un sous-revendeur" aria-label={'Créer sous '+r.name} onClick={()=>openCreate(r)}><UserPlus size={13}/></button>}
            <button className="icon-button ghost" style={{width:27,height:27}} title={r.status==='active'?'Suspendre':'Réactiver'} aria-label={(r.status==='active'?'Suspendre ':'Réactiver ')+r.name} disabled={working} onClick={()=>void run(async()=>{await request('/api/v1/admin/resellers/'+r.id+'/status','PUT',{status:r.status==='active'?'suspended':'active'});return r.status==='active'?'Revendeur suspendu.':'Revendeur réactivé.'})}>{r.status==='active'?<Pause size={13}/>:<Play size={13}/>}</button>
          </>:<span className="table-secondary">Géré par {r.parentName||'son parent'}</span>}
            <button className="icon-button ghost" style={{width:27,height:27}} aria-label={'Ouvrir '+r.name} onClick={()=>{setSelectedId(r.id);setTab('overview')}}><MoreHorizontal size={14}/></button></div></td>
        </tr>
      })}</tbody></table></div>
      {!filtered.length&&<div className="empty-state"><Network size={22}/><strong>Aucun revendeur pour ce filtre</strong><span>{isAdmin?'Créez un revendeur pour démarrer votre réseau.':'Créez votre premier sous-revendeur et transférez-lui des crédits.'}</span></div>}
    </section>

    {selected&&<><div className="drawer-backdrop" onClick={()=>setSelectedId('')}/><aside className="drawer" aria-label={'Fiche '+selected.name}>
      <div className="drawer-head"><div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}><div className="avatar">{selected.name.slice(0,1).toUpperCase()}</div><div style={{minWidth:0}}><strong>{selected.name}</strong><div className="card-subtitle">{selected.email}</div></div></div><button className="icon-button ghost" aria-label="Fermer" onClick={()=>setSelectedId('')}><X size={15}/></button></div>
      <div className="drawer-tabs">{([['overview','Aperçu'],['clients','Clients'],['ledger','Mouvements'],...(canManage(selected)?[['settings','Réglages']]:[])] as [DrawerTab,string][]).map(([k,v])=><button key={k} className={'drawer-tab'+(tab===k?' active':'')} onClick={()=>setTab(k)}>{v}</button>)}</div>
      <div className="drawer-body">
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><span className={'badge '+(selected.status==='active'?'badge-success':'badge-warning')}>{selected.status==='active'?'Actif':'Suspendu'}</span><span className="badge badge-neutral plain">Niveau {selected.hierarchyDepth||1}</span>{selected.parentName&&<span className="badge badge-neutral plain">Parent : {selected.parentName}</span>}</div>

        {tab==='overview'&&<>
          <div className="detail-grid">
            <div className="detail-item"><label>Solde</label><strong className="num">{Number(selected.credits).toFixed(2)} Go</strong></div>
            <div className="detail-item"><label>Clients actifs</label><strong className="num">{selected.active} / {selected.clients}</strong></div>
            <div className="detail-item"><label>Vendu / consommé</label><strong className="num">{selected.soldGb.toFixed(1)} / {selected.usedGb.toFixed(1)} Go</strong></div>
            <div className="detail-item"><label>CA · marge estimés</label><strong className="num">{money(selected.revenue)} · {money(selected.margin)}</strong></div>
            <div className="detail-item"><label>Sous-revendeurs</label><strong>{childrenOf(selected).length} direct(s) · {selected.descendantCount||0} au total</strong></div>
            <div className="detail-item"><label>Dernière connexion</label><strong>{selected.lastLoginAt?fmtDateTime(selected.lastLoginAt):'Jamais'}</strong></div>
          </div>
          {canManage(selected)&&<section className="drawer-section"><div className="ds-head"><div><h2>Crédits</h2><p>{isAdmin?'Ajout ou retrait par l’administration (paiement reçu manuellement).':'Transfert depuis votre solde ou récupération des crédits inutilisés.'}</p></div><Wallet size={14} color="var(--muted)"/></div>
            <form className="ds-body stack" style={{gap:10}} onSubmit={e=>{e.preventDefault();if(!amount)return;void run(async()=>{await request('/api/v1/admin/resellers/'+selected.id+'/credit','PUT',{amount:signed,...(creditNote.trim()?{note:creditNote.trim()}:{})});setCreditAmount('');setCreditNote('');return creditMode==='add'?amount+' Go transférés.':amount+' Go retirés.'})}}>
              <div className="filter-pills" style={{alignSelf:'flex-start'}}><button type="button" className={'filter-pill '+(creditMode==='add'?'active':'')} onClick={()=>setCreditMode('add')}>Ajouter</button><button type="button" className={'filter-pill '+(creditMode==='remove'?'active':'')} onClick={()=>setCreditMode('remove')}>Retirer</button></div>
              <div className="row-actions">{CREDIT_PRESETS.map(v=><button type="button" key={v} className={'preset'+(amount===v?' active':'')} style={{padding:'5px 10px'}} onClick={()=>setCreditAmount(String(v))}><strong>{v} Go</strong></button>)}</div>
              <div className="form-grid">
                <label className="field-block"><span className="field-label">Montant (Go)</span><input className="field num" type="number" min="0.01" step="0.01" required value={creditAmount} onChange={e=>setCreditAmount(e.target.value)} placeholder="0,00"/></label>
                <label className="field-block"><span className="field-label">Note (facultatif)</span><input className="field" maxLength={200} value={creditNote} onChange={e=>setCreditNote(e.target.value)} placeholder="Ex. Paiement MoMo réf. …"/></label>
              </div>
              <div className="detail-grid">
                <div className="detail-item"><label>Nouveau solde</label><strong className="num" style={{color:Number(selected.credits)+signed<0?'var(--danger)':undefined}}>{(Number(selected.credits)+signed).toFixed(2)} Go</strong></div>
                <div className="detail-item"><label>{isAdmin?'Origine':'Votre solde après'}</label><strong className="num" style={{color:!isAdmin&&myCredits-signed<0?'var(--danger)':undefined}}>{isAdmin?'Administration':(myCredits-signed).toFixed(2)+' Go'}</strong></div>
              </div>
              <button className="btn btn-primary" disabled={working||!amount||Number(selected.credits)+signed<0||(!isAdmin&&myCredits-signed<0)}>{creditMode==='add'?'Transférer '+(amount||0)+' Go':'Retirer '+(amount||0)+' Go'}</button>
            </form></section>}
          {childrenOf(selected).length>0&&<section className="drawer-section"><div className="ds-head"><div><h2>Sous-revendeurs directs</h2></div></div><div className="ds-body" style={{paddingTop:2,paddingBottom:2}}><div className="alert-list">{childrenOf(selected).map(c=><button key={c.id} className="alert-row" style={{width:'100%',background:'none',border:0,borderBottom:'1px solid var(--line)',textAlign:'left',color:'inherit'}} onClick={()=>{setSelectedId(c.id);setTab('overview')}}><div className="avatar" style={{width:24,height:24,fontSize:10}}>{c.name.slice(0,1)}</div><div><p>{c.name}</p><span>{Number(c.credits).toFixed(2)} Go · {c.status==='active'?'actif':'suspendu'}</span></div></button>)}</div></div></section>}
        </>}

        {tab==='clients'&&<section className="drawer-section"><div className="ds-head"><div><h2>Clients de {selected.name}</h2><p>{clientsOf(selected).length} licence(s) directe(s).</p></div></div><div className="ds-body" style={{paddingTop:2,paddingBottom:2}}>
          {!clientsOf(selected).length?<div className="empty-state"><Users size={20}/><strong>Aucun client</strong></div>:<div className="alert-list">{clientsOf(selected).map(a=>{const st=accountStatus(a);return <button key={a.id} className="alert-row" style={{width:'100%',background:'none',border:0,borderBottom:'1px solid var(--line)',textAlign:'left',color:'inherit'}} onClick={()=>onOpenClient?.(a.id)}>
            <div><p>{a.label}</p><span className="mono">{a.username} · expire {fmtDate(a.expiresAt)}</span></div><span className={'badge badge-'+st.tone}>{st.label}</span></button>})}</div>}
        </div></section>}

        {tab==='ledger'&&<section className="drawer-section"><div className="ds-head"><div><h2>Mouvements de crédits</h2><p>Ventes, renouvellements, transferts et recharges.</p></div></div><div className="ds-body" style={{paddingTop:2,paddingBottom:2}}>
          {!ledgerOf(selected).length?<div className="empty-state"><Wallet size={20}/><strong>Aucun mouvement</strong></div>:<div className="alert-list">{ledgerOf(selected).map(t=><div className="alert-row" key={t.id}>
            <span className="alert-dot" style={{background:t.type==='CREDIT_ADD'?'var(--success)':/SALE|RENEW|TRANSFER/.test(t.type)?'var(--warning)':'var(--info)'}}/>
            <div><p>{t.type.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase())} · {Number(t.amountGb).toFixed(2)} Go</p><span>{fmtDateTime(t.timestamp)} · {Number(t.balanceBefore).toFixed(2)} → {Number(t.balanceAfter).toFixed(2)} Go</span></div></div>)}</div>}
        </div></section>}

        {tab==='settings'&&canManage(selected)&&<>
          <section className="drawer-section"><div className="ds-head"><div><h2>Tarifs de la branche</h2><p>Base des estimations de chiffre d’affaires et de marge.</p></div><Tag size={14} color="var(--muted)"/></div>
            <form className="ds-body" onSubmit={e=>{e.preventDefault();void run(async()=>{await request('/api/v1/admin/resellers/'+selected.id+'/pricing','PUT',{pricePerGbCfa:priceGb,costPerGbCfa:costGb,pricePerLicenceCfa:priceLicence});return 'Tarifs enregistrés.'})}}>
              <div className="form-grid">
                <label className="field-block"><span className="field-label">Coût / Go (FCFA)</span><input className="field num" type="number" min={0} value={costGb} onChange={e=>setCostGb(Number(e.target.value))}/></label>
                <label className="field-block"><span className="field-label">Prix / Go (FCFA)</span><input className="field num" type="number" min={0} value={priceGb} onChange={e=>setPriceGb(Number(e.target.value))}/></label>
                <label className="field-block"><span className="field-label">Prix fixe / licence (FCFA)</span><input className="field num" type="number" min={0} value={priceLicence} onChange={e=>setPriceLicence(Number(e.target.value))}/></label>
                <div className="detail-item"><label>Marge / Go</label><strong>{money(priceGb-costGb)}</strong></div>
              </div>
              <button className="btn btn-sm" style={{marginTop:10}} disabled={working}>Enregistrer les tarifs</button>
            </form></section>
          <section className="drawer-section"><div className="ds-head"><div><h2>Profil</h2><p>Nom affiché et adresse de connexion.</p></div><Mail size={14} color="var(--muted)"/></div>
            <form className="ds-body" onSubmit={e=>{e.preventDefault();void run(async()=>{await request('/api/v1/admin/resellers/'+selected.id+'/profile','PUT',{name:editName,email:editEmail});return 'Profil mis à jour.'})}}>
              <div className="form-grid"><label className="field-block"><span className="field-label">Nom</span><input className="field" required maxLength={80} value={editName} onChange={e=>setEditName(e.target.value)}/></label>
                <label className="field-block"><span className="field-label">Email</span><input className="field" type="email" required value={editEmail} onChange={e=>setEditEmail(e.target.value)}/></label></div>
              <button className="btn btn-sm" style={{marginTop:10}} disabled={working||(editName===selected.name&&editEmail===selected.email)}>Enregistrer le profil</button>
            </form></section>
          <section className="drawer-section"><div className="ds-head"><div><h2>Mot de passe</h2><p>Réinitialise l’accès et déconnecte toutes ses sessions.</p></div><KeyRound size={14} color="var(--muted)"/></div>
            <div className="ds-body stack" style={{gap:8}}>
              <div className="input-group"><input className="field mono" aria-label="Nouveau mot de passe revendeur" placeholder="12 caractères minimum" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
                <button type="button" className="icon-button" title="Générer" aria-label="Générer un mot de passe revendeur" onClick={()=>setNewPassword(generatePassword())}><Wand2 size={14}/></button></div>
              <button className="btn btn-sm" style={{alignSelf:'flex-start'}} disabled={working||newPassword.length<12} onClick={()=>void run(async()=>{await request('/api/v1/admin/resellers/'+selected.id+'/password','PUT',{password:newPassword});setResetDone(newPassword);setNewPassword('');return 'Mot de passe réinitialisé.'})}>Réinitialiser</button>
              {resetDone&&<div className="notice notice-success">Nouveau mot de passe : <span className="mono">{resetDone}</span> <button className="btn btn-sm btn-ghost" onClick={()=>copy(accessMessage({name:selected.name,email:selected.email,password:resetDone}),'Accès copiés.')}><Copy size={12}/>Copier les accès</button></div>}
            </div></section>
          <section className="drawer-section" style={{borderColor:'color-mix(in srgb,var(--danger) 35%,transparent)'}}><div className="ds-head"><div><h2>Zone sensible</h2><p>Suspension réversible, ou suppression définitive de toute la branche.</p></div></div>
            <div className="ds-body row-actions">
              <button className="btn" disabled={working} onClick={()=>void run(async()=>{await request('/api/v1/admin/resellers/'+selected.id+'/status','PUT',{status:selected.status==='active'?'suspended':'active'});return selected.status==='active'?'Revendeur suspendu.':'Revendeur réactivé.'})}>{selected.status==='active'?<><Pause size={13}/>Suspendre</>:<><Play size={13}/>Réactiver</>}</button>
              <button className="btn btn-danger" style={{marginLeft:'auto'}} disabled={working} onClick={()=>{if(confirm(`Supprimer ${selected.name} et ses ${selected.descendantCount||0} sous-revendeur(s) ? Les crédits restants reviennent au parent et les clients lui sont transférés.`))void run(async()=>{const r=await request('/api/v1/admin/resellers/'+selected.id,'DELETE');setSelectedId('');return `Branche supprimée · ${r.refundedCreditsGb||0} Go remboursés · ${r.reassignedSshCount||0} client(s) transféré(s).`})}}><Trash2 size={13}/>Supprimer</button>
            </div></section>
        </>}
      </div>
    </aside></>}

    {createOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}>{created?<div className="modal" style={{width:'min(480px,100%)'}}>
      <div className="modal-head"><div><strong>Revendeur créé</strong><div className="card-subtitle">Transmettez-lui ses accès de façon sécurisée.</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setCreateOpen(false)}><X size={15}/></button></div>
      <div className="modal-body stack">
        <div className="detail-grid"><div className="detail-item"><label>Email</label><strong>{created.email}</strong></div><div className="detail-item"><label>Mot de passe</label><strong className="mono">{created.password}</strong></div></div>
        <p className="field-help">Ce mot de passe n’est affiché qu’une fois. Le revendeur pourra le changer dans « Sécurité ».</p>
      </div>
      <div className="modal-foot"><a className="btn" href={'https://wa.me/?text='+encodeURIComponent(accessMessage(created))} target="_blank" rel="noopener noreferrer">WhatsApp</a><button className="btn btn-primary" onClick={()=>copy(accessMessage(created),'Accès copiés.')}><Copy size={13}/>Copier les accès</button></div>
    </div>:<form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>{isAdmin?'Nouveau revendeur':'Nouveau sous-revendeur'}</strong><div className="card-subtitle">{isAdmin?'Choisissez éventuellement un revendeur parent.':'Il sera placé sous votre compte et pourra créer ses propres sous-revendeurs.'}</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setCreateOpen(false)}><X size={15}/></button></div>
      <div className="modal-body stack">
        <div className="form-grid">
          <label className="field-block"><span className="field-label">Nom</span><input className="field" required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex. Boutique Douala"/></label>
          <label className="field-block"><span className="field-label">Email</span><input className="field" type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="contact@exemple.com"/></label>
          <label className="field-block"><span className="field-label">Mot de passe initial</span>
            <div className="input-group"><input className="field mono" type={showPw?'text':'password'} minLength={16} required value={password} onChange={e=>setPassword(e.target.value)}/>
              <button type="button" className="icon-button" aria-label="Afficher le mot de passe initial" onClick={()=>setShowPw(v=>!v)}>{showPw?<EyeOff size={14}/>:<Eye size={14}/>}</button>
              <button type="button" className="icon-button" aria-label="Générer le mot de passe initial" onClick={()=>{setPassword(generatePassword());setShowPw(true)}}><Wand2 size={14}/></button></div></label>
          <label className="field-block"><span className="field-label">Crédits de départ (Go)</span><input className="field num" type="number" min={0} step=".01" value={credits} onChange={e=>setCredits(Number(e.target.value))}/>{!isAdmin&&<span className="field-help">Prélevés sur votre solde ({myCredits.toFixed(2)} Go).</span>}</label>
          {isAdmin&&<label className="field-block" style={{gridColumn:'1/-1'}}><span className="field-label">Parent dans le réseau</span><select className="select" value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">Administration principale</option>{resellers.map(r=><option key={r.id} value={r.id}>{'— '.repeat(Math.max(0,(r.hierarchyDepth||1)-1))}{r.name}</option>)}</select></label>}
        </div>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreateOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={working||busy||(!isAdmin&&credits>myCredits)}>Créer le revendeur</button></div>
    </form>}</div>}
  </div>;
}

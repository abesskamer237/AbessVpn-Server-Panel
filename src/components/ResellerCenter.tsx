import {useMemo,useState,type FormEvent} from 'react';
import {BadgeDollarSign,ChevronRight,CornerDownRight,Download,Network,Pause,Play,Plus,Search,Store,Tag,UserPlus,Users,Wallet,X} from 'lucide-react';
import type {Reseller,SshAccount,User} from '../panelTypes';
import {bytesToGb,csvDownload,money} from '../panelTypes';

type Props={
  resellers:Reseller[];accounts:SshAccount[];busy:boolean;currentUser:User;
  request:(url:string,method?:string,body?:unknown)=>Promise<any>;
  refresh:()=>Promise<void>;
};

export function ResellerCenter({resellers,accounts,busy,currentUser,request,refresh}:Props){
  const [createOpen,setCreateOpen]=useState(false);
  const [parentId,setParentId]=useState('');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[credits,setCredits]=useState(0);
  const [pricing,setPricing]=useState<Reseller|null>(null);
  const [priceGb,setPriceGb]=useState(0),[costGb,setCostGb]=useState(0),[priceLicence,setPriceLicence]=useState(0);
  const [creditFor,setCreditFor]=useState<Reseller|null>(null),[creditAmount,setCreditAmount]=useState(''),[creditMode,setCreditMode]=useState<'add'|'remove'>('add');
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const isAdmin=currentUser.role==='SUPER_ADMIN'||currentUser.role==='ADMIN';

  const rows=useMemo(()=>resellers.map(r=>{
    const mine=accounts.filter(a=>a.resellerId===r.id&&a.managed);
    const branchIds=new Set<string>([r.id]);
    const pending=[r.id];
    while(pending.length){
      const parent=pending.pop()!;
      for(const child of resellers){
        if(child.parentId===parent&&!branchIds.has(child.id)){branchIds.add(child.id);pending.push(child.id)}
      }
    }
    const branch=accounts.filter(a=>a.resellerId&&branchIds.has(a.resellerId)&&a.managed);
    const active=mine.filter(a=>a.effectiveEnabled).length;
    const soldGb=mine.reduce((n,a)=>n+bytesToGb(a.quotaBytes),0);
    const usedGb=mine.reduce((n,a)=>n+bytesToGb(a.usedBytes),0);
    const revenue=soldGb*(r.pricePerGbCfa||0)+mine.length*(r.pricePerLicenceCfa||0);
    const cost=soldGb*(r.costPerGbCfa||0);
    return {...r,clients:mine.length,branchClients:branch.length,active,soldGb,usedGb,revenue,margin:revenue-cost};
  }),[resellers,accounts]);

  const filtered=useMemo(()=>rows.filter(r=>
    [r.name,r.email,r.parentName||'',...(r.hierarchyPath||[])].join(' ').toLowerCase().includes(search.toLowerCase())
  ).sort((a,b)=>{
    const pa=(a.hierarchyPath||[a.name]).join(' / '),pb=(b.hierarchyPath||[b.name]).join(' / ');
    return pa.localeCompare(pb,'fr');
  }),[rows,search]);

  const totalCredits=resellers.reduce((n,r)=>n+Number(r.credits||0),0);
  const totalClients=accounts.filter(a=>a.managed&&resellers.some(r=>r.id===a.resellerId)).length;
  const totalRevenue=rows.reduce((n,r)=>n+r.revenue,0);
  const totalMargin=rows.reduce((n,r)=>n+r.margin,0);
  const maxDepth=Math.max(0,...resellers.map(r=>Number(r.hierarchyDepth||0)));
  const directChildren=resellers.filter(r=>r.parentId===currentUser.id);
  const canDirectlyManage=(r:Reseller)=>isAdmin||r.parentId===currentUser.id;

  async function run(work:()=>Promise<void>){
    setError('');
    try{await work();await refresh()}catch(e){setError(e instanceof Error?e.message:'Opération impossible')}
  }
  function openCreate(parent?:Reseller){
    setParentId(isAdmin?(parent?.id||''):'');
    setCreateOpen(true);setError('');
  }
  async function create(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      await request('/api/v1/admin/resellers','POST',{
        name,email,password,initialCredits:credits,
        ...(isAdmin&&parentId?{parentId}:{})
      });
      setName('');setEmail('');setPassword('');setCredits(0);setParentId('');setCreateOpen(false);
    });
  }
  function openPricing(r:Reseller){setPricing(r);setPriceGb(r.pricePerGbCfa||0);setCostGb(r.costPerGbCfa||0);setPriceLicence(r.pricePerLicenceCfa||0)}

  return <div className="stack">
    <div className="page-header"><div><h1>Revendeurs</h1><p>Réseau hiérarchique multi-niveaux, crédits et performance commerciale.</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>csvDownload('abess-revendeurs.csv',[
          ['Niveau','Chemin','Revendeur','Email','Parent','Solde Go','Clients directs','Descendants','CA estimé XAF','Marge estimée XAF'],
          ...rows.map(r=>[r.hierarchyDepth||0,(r.hierarchyPath||[r.name]).join(' > '),r.name,r.email,r.parentName||'',r.credits,r.clients,r.descendantCount||0,r.revenue,r.margin])
        ])}><Download size={14}/>CSV</button>
        <button className="btn btn-primary" onClick={()=>openCreate()}><Plus size={14}/>{isAdmin?'Nouveau revendeur':'Nouveau sous-revendeur'}</button>
      </div>
    </div>

    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><Network size={14}/>Réseau visible</div><div className="metric-value">{resellers.length}</div><div className="metric-foot">{directChildren.length} enfant(s) direct(s) · profondeur {maxDepth}</div></div>
      <div className="card metric-card"><div className="metric-label"><Users size={14}/>Clients gérés</div><div className="metric-value">{totalClients}</div><div className="metric-foot">Licences SSH-WSS de la branche</div></div>
      <div className="card metric-card"><div className="metric-label"><BadgeDollarSign size={14}/>Crédits réseau</div><div className="metric-value">{totalCredits.toFixed(1)} Go</div><div className="metric-foot">{currentUser.role==='RESELLER'?'Votre solde : '+Number(currentUser.credits||0).toFixed(2)+' Go':'Soldes de tous les revendeurs visibles'}</div></div>
      <div className="card metric-card"><div className="metric-label"><Store size={14}/>Marge estimée</div><div className="metric-value">{money(totalMargin)}</div><div className="metric-foot">CA estimé {money(totalRevenue)}</div></div>
    </div>


    {error&&<p className="notice" role="alert">{error}</p>}

    <section className="card">
      <div className="panel-head">
        <div><h2>Arbre des revendeurs</h2><p>Chaque compte gère ses enfants directs et voit toute sa descendance.</p></div>
        <div className="search-wrap"><Search size={14}/><input className="search-input" placeholder="Nom, email, branche…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      </div>
      <div style={{overflow:'auto'}}><table className="data-table"><thead><tr>
        <th>Revendeur</th><th>Solde</th><th>Clients</th><th>Consommation</th><th>CA estimé</th><th>État</th><th style={{width:1}}></th>
      </tr></thead><tbody>{filtered.map(r=>{
        const depth=Math.max(0,Number(r.hierarchyDepth||0)-1);
        const manageable=canDirectlyManage(r);
        return <tr key={r.id}>
          <td><div style={{display:'flex',alignItems:'center',gap:8,paddingLeft:Math.min(depth,6)*20}}>
            {depth>0&&<CornerDownRight size={13} color="var(--muted-2)"/>}
            <div className="avatar" style={{width:26,height:26,fontSize:11}}>{r.name.slice(0,1).toUpperCase()}</div>
            <div style={{minWidth:0}}><div className="table-primary">{r.name}</div><div className="table-secondary">{r.email}{r.parentName&&depth>0?' · sous '+r.parentName:''}</div></div>
          </div></td>
          <td className="num table-primary">{Number(r.credits).toFixed(2)} <span className="table-secondary">Go</span></td>
          <td className="num"><span className="table-primary">{r.active}</span><span className="table-secondary"> / {r.clients}</span>{(r.descendantCount||0)>0&&<div className="table-secondary">{r.descendantCount} sous-revendeur(s)</div>}</td>
          <td className="num">{r.usedGb.toFixed(1)} <span className="table-secondary">/ {r.soldGb.toFixed(1)} Go</span></td>
          <td className="num"><div className="table-primary">{money(r.revenue)}</div><div className="table-secondary">marge {money(r.margin)}</div></td>
          <td><span className={'badge '+(r.status==='active'?'badge-success':'badge-warning')}>{r.status==='active'?'Actif':'Suspendu'}</span></td>
          <td><div className="row-actions">{manageable?<>
            <button className="btn btn-sm" disabled={busy} onClick={()=>{setCreditFor(r);setCreditAmount('');setCreditMode('add')}}><Wallet size={12}/>Crédits</button>
            <button className="icon-button ghost" style={{width:27,height:27}} title="Tarifs" aria-label={'Tarifs '+r.name} onClick={()=>openPricing(r)}><Tag size={13}/></button>
            {isAdmin&&<button className="icon-button ghost" style={{width:27,height:27}} title="Créer un sous-revendeur" aria-label={'Créer sous '+r.name} onClick={()=>openCreate(r)}><UserPlus size={13}/></button>}
            <button className="icon-button ghost" style={{width:27,height:27}} title={r.status==='active'?'Suspendre':'Réactiver'} aria-label={(r.status==='active'?'Suspendre ':'Réactiver ')+r.name} disabled={busy} onClick={()=>void run(async()=>request('/api/v1/admin/resellers/'+r.id+'/status','PUT',{status:r.status==='active'?'suspended':'active'}))}>{r.status==='active'?<Pause size={13}/>:<Play size={13}/>}</button>
          </>:<span className="table-secondary">Géré par {r.parentName||'son parent'}</span>}</div></td>
        </tr>
      })}</tbody></table></div>
      {!filtered.length&&<div className="empty-state"><Network size={22}/><strong>Aucun revendeur dans cette branche</strong><span>Créez le premier sous-revendeur pour démarrer votre réseau.</span></div>}
    </section>

    {creditFor&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreditFor(null)}}><form className="modal" style={{width:'min(440px,100%)'}} onSubmit={e=>{e.preventDefault();const v=Number(creditAmount);if(!v)return;void run(async()=>{await request('/api/v1/admin/resellers/'+creditFor.id+'/credit','PUT',{amount:creditMode==='add'?v:-v});setCreditFor(null)})}}>
      <div className="modal-head"><div><strong>Crédits · {creditFor.name}</strong><div className="card-subtitle">Solde actuel {Number(creditFor.credits).toFixed(2)} Go</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setCreditFor(null)}><X size={15}/></button></div>
      <div className="modal-body stack">
        <div className="filter-pills" style={{alignSelf:'flex-start'}}><button type="button" className={'filter-pill '+(creditMode==='add'?'active':'')} onClick={()=>setCreditMode('add')}>Ajouter</button><button type="button" className={'filter-pill '+(creditMode==='remove'?'active':'')} onClick={()=>setCreditMode('remove')}>Retirer</button></div>
        <label className="field-block"><span className="field-label">Montant (Go)</span><input className="field num" autoFocus type="number" min="0.01" step="0.01" required value={creditAmount} onChange={e=>setCreditAmount(e.target.value)} placeholder="0,00"/></label>
        <div className="detail-grid">
          <div className="detail-item"><label>Nouveau solde</label><strong className="num">{Math.max(0,Number(creditFor.credits)+(creditMode==='add'?1:-1)*Number(creditAmount||0)).toFixed(2)} Go</strong></div>
          <div className="detail-item"><label>{isAdmin?'Origine':'Votre solde après'}</label><strong className="num">{isAdmin?'Administration':(Number(currentUser.credits||0)-(creditMode==='add'?1:-1)*Number(creditAmount||0)).toFixed(2)+' Go'}</strong></div>
        </div>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreditFor(null)}>Annuler</button><button className="btn btn-primary" disabled={busy||!Number(creditAmount)}>{creditMode==='add'?'Transférer':'Retirer'}</button></div>
    </form></div>}

    {createOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}><form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>{isAdmin?'Nouveau revendeur':'Nouveau sous-revendeur'}</strong><div className="card-subtitle">{isAdmin?'Choisissez éventuellement un revendeur parent.':'Ce compte sera placé directement sous votre compte et pourra créer ses propres enfants.'}</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setCreateOpen(false)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Nom</span><input className="field" required value={name} onChange={e=>setName(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Email</span><input className="field" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Mot de passe initial</span><input className="field" type="password" minLength={16} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Crédits de départ (Go)</span><input className="field" type="number" min={0} step=".01" value={credits} onChange={e=>setCredits(Number(e.target.value))}/></label>
        {isAdmin&&<label className="field-block" style={{gridColumn:'1/-1'}}><span className="field-label">Parent dans le réseau</span><select className="select" value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">Administration principale</option>{resellers.map(r=><option key={r.id} value={r.id}>{'— '.repeat(Math.max(0,(r.hierarchyDepth||1)-1))}{r.name}</option>)}</select></label>}
        {!isAdmin&&<div className="detail-item" style={{gridColumn:'1/-1'}}><label>Parent</label><strong>{currentUser.name} · solde disponible {Number(currentUser.credits||0).toFixed(2)} Go</strong></div>}
      </div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreateOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={busy||(!isAdmin&&credits>Number(currentUser.credits||0))}>Créer le revendeur</button></div>
    </form></div>}

    {pricing&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPricing(null)}}><form className="modal" onSubmit={e=>{e.preventDefault();void run(async()=>{await request('/api/v1/admin/resellers/'+pricing.id+'/pricing','PUT',{pricePerGbCfa:priceGb,costPerGbCfa:costGb,pricePerLicenceCfa:priceLicence});setPricing(null)})}}>
      <div className="modal-head"><div><strong>Tarifs · {pricing.name}</strong><div className="card-subtitle">Référence commerciale pour cette branche.</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setPricing(null)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Coût / Go (FCFA)</span><input className="field" type="number" min={0} value={costGb} onChange={e=>setCostGb(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Prix / Go (FCFA)</span><input className="field" type="number" min={0} value={priceGb} onChange={e=>setPriceGb(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Prix fixe / licence (FCFA)</span><input className="field" type="number" min={0} value={priceLicence} onChange={e=>setPriceLicence(Number(e.target.value))}/></label>
        <div className="detail-item"><label>Marge / Go</label><strong>{money(priceGb-costGb)}</strong></div>
      </div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setPricing(null)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Enregistrer</button></div>
    </form></div>}
  </div>
}

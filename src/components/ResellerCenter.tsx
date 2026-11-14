import {useMemo,useState,type FormEvent} from 'react';
import {BadgeDollarSign,ChevronRight,Network,Plus,Search,Store,Users,X} from 'lucide-react';
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
  const [credit,setCredit]=useState<Record<string,string>>({});
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
        ])}>Exporter CSV</button>
        <button className="btn btn-primary" onClick={()=>openCreate()}><Plus size={15}/>{isAdmin?'Nouveau revendeur':'Nouveau sous-revendeur'}</button>
      </div>
    </div>

    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><Network size={14}/>Réseau visible</div><div className="metric-value">{resellers.length}</div><div className="metric-foot">{directChildren.length} enfant(s) direct(s) · profondeur {maxDepth}</div></div>
      <div className="card metric-card"><div className="metric-label"><Users size={14}/>Clients gérés</div><div className="metric-value">{totalClients}</div><div className="metric-foot">Licences SSH-WSS de la branche</div></div>
      <div className="card metric-card"><div className="metric-label"><BadgeDollarSign size={14}/>Crédits réseau</div><div className="metric-value">{totalCredits.toFixed(1)} Go</div><div className="metric-foot">{currentUser.role==='RESELLER'?'Votre solde : '+Number(currentUser.credits||0).toFixed(2)+' Go':'Soldes de tous les revendeurs visibles'}</div></div>
      <div className="card metric-card"><div className="metric-label"><Store size={14}/>Marge estimée</div><div className="metric-value">{money(totalMargin)}</div><div className="metric-foot">CA estimé {money(totalRevenue)}</div></div>
    </div>

    {currentUser.role==='RESELLER'&&<div className="card card-pad" style={{borderColor:'rgba(32,217,130,.28)'}}>
      <div className="section-head"><div><h2>Votre branche de revente</h2><p>Vous pouvez créer des sous-revendeurs. Chacun d’eux pourra se connecter et créer à son tour ses propres sous-revendeurs.</p></div><span className="badge badge-success">Multi-niveaux actif</span></div>
      <div className="service-line"><span>Votre niveau</span><strong>Parent de {directChildren.length} revendeur(s)</strong></div>
      <div className="service-line"><span>Règle de crédits</span><strong>Un enfant reçoit uniquement les Go transférés par son parent direct</strong></div>
      <div className="service-line"><span>Isolation</span><strong>Chaque branche ne peut gérer que ses propres descendants</strong></div>
    </div>}

    {error&&<p className="notice" role="alert">{error}</p>}

    <section className="card card-pad">
      <div className="section-head"><div><h2>Arbre des revendeurs</h2><p>La profondeur est illimitée côté logique ; chaque compte contrôle ses enfants directs et voit sa descendance.</p></div></div>
      <div className="toolbar"><div className="search-wrap"><Search size={14}/><input className="search-input" placeholder="Nom, email, parent ou branche…" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr>
        <th>Hiérarchie</th><th>Solde</th><th>Clients</th><th>Consommation</th><th>CA / marge</th><th>État</th><th>Actions</th>
      </tr></thead><tbody>{filtered.map(r=>{
        const depth=Math.max(0,Number(r.hierarchyDepth||0)-1);
        const manageable=canDirectlyManage(r);
        return <tr key={r.id}>
          <td><div style={{display:'flex',alignItems:'center',gap:6,paddingLeft:Math.min(depth,8)*18}}>
            {depth>0&&<><span style={{color:'var(--muted-2)'}}>└</span><ChevronRight size={12} color="var(--muted)"/></>}
            <div><div className="table-primary">{r.name}</div><div className="table-secondary">{r.email} · niveau {r.hierarchyDepth||1}{r.parentName?' · parent : '+r.parentName:''}</div></div>
          </div></td>
          <td>{Number(r.credits).toFixed(2)} Go</td>
          <td><div className="table-primary">{r.active} actifs / {r.clients} directs</div><div className="table-secondary">{r.descendantCount||0} sous-revendeur(s) · {r.branchClients} clients branche</div></td>
          <td>{r.usedGb.toFixed(2)} / {r.soldGb.toFixed(2)} Go</td>
          <td><div className="table-primary">{money(r.revenue)}</div><div className="table-secondary">Marge {money(r.margin)}</div></td>
          <td><span className={'badge '+(r.status==='active'?'badge-success':'badge-warning')}>{r.status==='active'?'Actif':'Suspendu'}</span></td>
          <td><div className="row-actions">
            {isAdmin&&<button className="btn btn-sm" onClick={()=>openCreate(r)}><Plus size={12}/>Créer dessous</button>}
            {manageable&&<><input className="field" aria-label={'Crédit '+r.name} style={{width:78}} type="number" step=".01" placeholder="+ Go" value={credit[r.id]||''} onChange={e=>setCredit(v=>({...v,[r.id]:e.target.value}))}/>
            <button className="btn btn-sm" disabled={busy||!Number(credit[r.id])} onClick={()=>void run(async()=>{await request('/api/v1/admin/resellers/'+r.id+'/credit','PUT',{amount:Number(credit[r.id])});setCredit(v=>({...v,[r.id]:''}))})}>Transférer</button>
            <button className="btn btn-sm" onClick={()=>openPricing(r)}>Tarifs</button>
            <button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>request('/api/v1/admin/resellers/'+r.id+'/status','PUT',{status:r.status==='active'?'suspended':'active'}))}>{r.status==='active'?'Suspendre':'Réactiver'}</button></>}
            {!manageable&&<span className="table-secondary">Géré par {r.parentName||'son parent'}</span>}
          </div></td>
        </tr>
      })}</tbody></table></div>
      {!filtered.length&&<div className="empty-state"><Network size={26}/><strong>Aucun revendeur dans cette branche</strong><span>Créez le premier sous-revendeur pour démarrer votre réseau.</span></div>}
    </section>

    {createOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}><form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>{isAdmin?'Nouveau revendeur':'Nouveau sous-revendeur'}</strong><div className="card-subtitle">{isAdmin?'Choisissez éventuellement un revendeur parent.':'Ce compte sera placé directement sous votre compte et pourra créer ses propres enfants.'}</div></div><button type="button" className="icon-button" onClick={()=>setCreateOpen(false)}><X size={16}/></button></div>
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
      <div className="modal-head"><div><strong>Tarifs · {pricing.name}</strong><div className="card-subtitle">Référence commerciale pour cette branche.</div></div><button type="button" className="icon-button" onClick={()=>setPricing(null)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Coût / Go (FCFA)</span><input className="field" type="number" min={0} value={costGb} onChange={e=>setCostGb(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Prix / Go (FCFA)</span><input className="field" type="number" min={0} value={priceGb} onChange={e=>setPriceGb(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Prix fixe / licence (FCFA)</span><input className="field" type="number" min={0} value={priceLicence} onChange={e=>setPriceLicence(Number(e.target.value))}/></label>
        <div className="detail-item"><label>Marge / Go</label><strong>{money(priceGb-costGb)}</strong></div>
      </div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setPricing(null)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Enregistrer</button></div>
    </form></div>}
  </div>
}

import {useMemo,useState,type FormEvent} from 'react';
import {BadgeDollarSign,Plus,Store,Users,X} from 'lucide-react';
import type {Reseller,SshAccount} from '../panelTypes';
import {bytesToGb,csvDownload} from '../panelTypes';

type Props={
  resellers:Reseller[];accounts:SshAccount[];busy:boolean;
  request:(url:string,method?:string,body?:unknown)=>Promise<any>;
  refresh:()=>Promise<void>;
};
const money=(n:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'XAF',maximumFractionDigits:0}).format(n||0);

export function ResellerCenter({resellers,accounts,busy,request,refresh}:Props){
  const [createOpen,setCreateOpen]=useState(false);
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[credits,setCredits]=useState(0);
  const [pricing,setPricing]=useState<Reseller|null>(null);
  const [priceGb,setPriceGb]=useState(0),[costGb,setCostGb]=useState(0),[priceLicence,setPriceLicence]=useState(0);
  const [credit,setCredit]=useState<Record<string,string>>({});
  const [error,setError]=useState('');
  const rows=useMemo(()=>resellers.map(r=>{
    const mine=accounts.filter(a=>a.resellerId===r.id&&a.managed);
    const active=mine.filter(a=>a.effectiveEnabled).length;
    const soldGb=mine.reduce((n,a)=>n+bytesToGb(a.quotaBytes),0);
    const usedGb=mine.reduce((n,a)=>n+bytesToGb(a.usedBytes),0);
    const revenue=soldGb*(r.pricePerGbCfa||0)+mine.length*(r.pricePerLicenceCfa||0);
    const cost=soldGb*(r.costPerGbCfa||0);
    return {...r,clients:mine.length,active,soldGb,usedGb,revenue,margin:revenue-cost};
  }),[resellers,accounts]);
  const totalCredits=resellers.reduce((n,r)=>n+Number(r.credits||0),0);
  const totalClients=rows.reduce((n,r)=>n+r.clients,0);
  const totalRevenue=rows.reduce((n,r)=>n+r.revenue,0);
  const totalMargin=rows.reduce((n,r)=>n+r.margin,0);

  async function run(work:()=>Promise<void>){
    setError('');
    try{await work();await refresh()}catch(e){setError(e instanceof Error?e.message:'Opération impossible')}
  }
  async function create(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      await request('/api/v1/admin/resellers','POST',{name,email,password,initialCredits:credits});
      setName('');setEmail('');setPassword('');setCredits(0);setCreateOpen(false);
    });
  }
  function openPricing(r:Reseller){setPricing(r);setPriceGb(r.pricePerGbCfa||0);setCostGb(r.costPerGbCfa||0);setPriceLicence(r.pricePerLicenceCfa||0)}
  return <div className="stack">
    <div className="page-header"><div><h1>Revendeurs</h1><p>Soldes, portefeuille clients et performance commerciale.</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>csvDownload('abess-revendeurs.csv',[
          ['Revendeur','Email','Solde Go','Clients','Actifs','Go alloués','Go consommés','CA estimé XAF','Marge estimée XAF'],
          ...rows.map(r=>[r.name,r.email,r.credits,r.clients,r.active,r.soldGb,r.usedGb,r.revenue,r.margin])
        ])}>Exporter CSV</button>
        <button className="btn btn-primary" onClick={()=>setCreateOpen(true)}><Plus size={15}/>Nouveau revendeur</button>
      </div>
    </div>
    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><Store size={14}/>Revendeurs</div><div className="metric-value">{resellers.length}</div><div className="metric-foot">{resellers.filter(r=>r.status==='active').length} actifs</div></div>
      <div className="card metric-card"><div className="metric-label"><Users size={14}/>Clients gérés</div><div className="metric-value">{totalClients}</div><div className="metric-foot">Licences SSH-WSS attribuées</div></div>
      <div className="card metric-card"><div className="metric-label"><BadgeDollarSign size={14}/>Crédits en circulation</div><div className="metric-value">{totalCredits.toFixed(1)} Go</div><div className="metric-foot">Soldes disponibles</div></div>
      <div className="card metric-card"><div className="metric-label"><BadgeDollarSign size={14}/>Marge estimée</div><div className="metric-value">{money(totalMargin)}</div><div className="metric-foot">CA estimé {money(totalRevenue)}</div></div>
    </div>
    {error&&<p className="notice" role="alert">{error}</p>}
    <section className="card card-pad">
      <div className="section-head"><div><h2>Portefeuille revendeurs</h2><p>Les estimations financières utilisent les tarifs de référence configurés ci-dessous.</p></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr>
        <th>Revendeur</th><th>Solde</th><th>Clients</th><th>Consommation</th><th>CA / marge estimés</th><th>État</th><th>Actions</th>
      </tr></thead><tbody>{rows.map(r=><tr key={r.id}>
        <td><div className="table-primary">{r.name}</div><div className="table-secondary">{r.email}</div></td>
        <td>{Number(r.credits).toFixed(2)} Go</td>
        <td>{r.active} actifs / {r.clients}</td>
        <td>{r.usedGb.toFixed(2)} / {r.soldGb.toFixed(2)} Go</td>
        <td><div className="table-primary">{money(r.revenue)}</div><div className="table-secondary">Marge {money(r.margin)}</div></td>
        <td><span className={'badge '+(r.status==='active'?'badge-success':'badge-warning')}>{r.status==='active'?'Actif':'Suspendu'}</span></td>
        <td><div className="row-actions">
          <input className="field" style={{width:80}} type="number" min="0.01" step="0.01" placeholder="+ Go" value={credit[r.id]||''} onChange={e=>setCredit(v=>({...v,[r.id]:e.target.value}))}/>
          <button className="btn btn-sm" disabled={busy||Number(credit[r.id])<=0} onClick={()=>void run(async()=>{await request('/api/v1/admin/resellers/'+r.id+'/credit','PUT',{amount:Number(credit[r.id])});setCredit(v=>({...v,[r.id]:''}))})}>Créditer</button>
          <button className="btn btn-sm" onClick={()=>openPricing(r)}>Tarifs</button>
          <button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>request('/api/v1/admin/resellers/'+r.id+'/status','PUT',{status:r.status==='active'?'suspended':'active'}))}>{r.status==='active'?'Suspendre':'Réactiver'}</button>
        </div></td>
      </tr>)}</tbody></table></div>
    </section>

    {createOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}><form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>Nouveau revendeur</strong><div className="card-subtitle">Créer un accès commercial SSH-WSS.</div></div><button type="button" className="icon-button" onClick={()=>setCreateOpen(false)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Nom</span><input className="field" required value={name} onChange={e=>setName(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Email</span><input className="field" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Mot de passe initial</span><input className="field" type="password" minLength={16} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Crédits de départ (Go)</span><input className="field" type="number" min={0} step=".01" value={credits} onChange={e=>setCredits(Number(e.target.value))}/></label>
      </div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setCreateOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Créer le revendeur</button></div>
    </form></div>}

    {pricing&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPricing(null)}}><form className="modal" onSubmit={e=>{e.preventDefault();void run(async()=>{await request('/api/v1/admin/resellers/'+pricing.id+'/pricing','PUT',{pricePerGbCfa:priceGb,costPerGbCfa:costGb,pricePerLicenceCfa:priceLicence});setPricing(null)})}}>
      <div className="modal-head"><div><strong>Tarifs · {pricing.name}</strong><div className="card-subtitle">Ces valeurs servent aux estimations du tableau de bord, pas à un prélèvement automatique.</div></div><button type="button" className="icon-button" onClick={()=>setPricing(null)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Coût de revient / Go (FCFA)</span><input className="field" type="number" min={0} value={costGb} onChange={e=>setCostGb(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Prix de vente / Go (FCFA)</span><input className="field" type="number" min={0} value={priceGb} onChange={e=>setPriceGb(Number(e.target.value))}/></label>
        <label className="field-block"><span className="field-label">Forfait fixe / licence (FCFA)</span><input className="field" type="number" min={0} value={priceLicence} onChange={e=>setPriceLicence(Number(e.target.value))}/></label>
        <div className="detail-item"><label>Marge théorique / Go</label><strong>{money(Math.max(0,priceGb-costGb))}</strong></div>
      </div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setPricing(null)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Enregistrer</button></div>
    </form></div>}
  </div>;
}

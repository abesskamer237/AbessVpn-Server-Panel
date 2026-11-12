import {useState,type FormEvent} from 'react';
import {Shield,UserCog,UserPlus,X} from 'lucide-react';
import type {Operator} from '../panelTypes';
import {fmtDateTime} from '../panelTypes';

type Props={operators:Operator[];busy:boolean;request:(url:string,method?:string,body?:unknown)=>Promise<any>;refresh:()=>Promise<void>};
export function TeamCenter({operators,busy,request,refresh}:Props){
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
  async function run(work:()=>Promise<void>){setError('');try{await work();await refresh()}catch(e){setError(e instanceof Error?e.message:'Opération impossible')}}
  async function create(e:FormEvent){e.preventDefault();await run(async()=>{await request('/api/v1/admin/operators','POST',{name,email,password});setName('');setEmail('');setPassword('');setOpen(false)})}
  return <div className="stack">
    <div className="page-header"><div><h1>Équipe</h1><p>Délègue les opérations quotidiennes sans partager le compte Super Administrateur.</p></div>
      <button className="btn btn-primary" onClick={()=>setOpen(true)}><UserPlus size={15}/>Nouvel administrateur</button></div>
    <div className="grid-equal">
      <section className="card card-pad"><div className="section-head"><div><h2>Rôles</h2><p>Séparation claire des privilèges.</p></div><Shield size={18}/></div>
        <div className="service-line"><span><strong>Super Administrateur</strong><br/><small style={{color:'var(--muted)'}}>Infrastructure, sauvegardes, équipe, clients et commerce</small></span><span className="badge badge-danger">Critique</span></div>
        <div className="service-line"><span><strong>Administrateur</strong><br/><small style={{color:'var(--muted)'}}>Clients, revendeurs, crédits et opérations commerciales</small></span><span className="badge badge-info">Opérations</span></div>
        <div className="service-line"><span><strong>Revendeur</strong><br/><small style={{color:'var(--muted)'}}>Ses clients, sous-revendeurs et son propre solde</small></span><span className="badge badge-success">Commercial</span></div>
      </section>
      <section className="card metric-card"><div className="metric-label"><UserCog size={14}/>Administrateurs délégués</div><div className="metric-value">{operators.length}</div><div className="metric-foot">{operators.filter(o=>o.status==='active').length} comptes actifs</div></section>
    </div>
    {error&&<p className="notice" role="alert">{error}</p>}
    <section className="card card-pad"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Administrateur</th><th>Dernière connexion</th><th>Création</th><th>État</th><th>Action</th></tr></thead>
      <tbody>{operators.map(o=><tr key={o.id}><td><div className="table-primary">{o.name}</div><div className="table-secondary">{o.email}</div></td><td>{fmtDateTime(o.lastLoginAt||undefined)}</td><td>{fmtDateTime(o.createdAt)}</td>
        <td><span className={'badge '+(o.status==='active'?'badge-success':'badge-warning')}>{o.status==='active'?'Actif':'Suspendu'}</span></td>
        <td><button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>request('/api/v1/admin/operators/'+o.id+'/status','PUT',{status:o.status==='active'?'suspended':'active'}))}>{o.status==='active'?'Suspendre':'Réactiver'}</button></td></tr>)}</tbody>
    </table></div>{!operators.length&&<div className="empty-state"><UserCog size={24}/><strong>Aucun administrateur délégué</strong><span>Le Super Administrateur reste le seul compte privilégié.</span></div>}</section>
    {open&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><form className="modal" onSubmit={e=>void create(e)}>
      <div className="modal-head"><div><strong>Nouvel administrateur</strong><div className="card-subtitle">Accès opérationnel sans privilèges infrastructure.</div></div><button type="button" className="icon-button" onClick={()=>setOpen(false)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Nom</span><input className="field" required value={name} onChange={e=>setName(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Email</span><input className="field" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Mot de passe initial</span><input className="field" type="password" minLength={16} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      </div><div className="modal-foot"><button type="button" className="btn" onClick={()=>setOpen(false)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Créer l’accès</button></div>
    </form></div>}
  </div>
}

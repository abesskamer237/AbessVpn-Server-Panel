import {useMemo,useState} from 'react';
import {Download,FileSearch,Search,ShieldAlert} from 'lucide-react';
import type {AuditEvent} from '../panelTypes';
import {csvDownload,fmtDateTime} from '../panelTypes';

type Props={audit:AuditEvent[];people:Map<string,string>};

const sensitive=/DELETE|RESTORE|PASSWORD|MFA|SUSPEND|STATUS|CONFIRMED|REJECTED|EXPORTED|KEY|LOGIN_FAILED/;
const families:[string,string,RegExp][]=[
  ['all','Tout',/./],
  ['clients','Clients SSH',/^SSH_/],
  ['commerce','Commerce',/PAYMENT|CREDIT|PLAN|RESELLER|ORDER/],
  ['security','Sécurité',/LOGIN|LOGOUT|MFA|PASSWORD|SESSION|OPERATOR/],
  ['infra','Infrastructure',/NODE|BACKUP|RESTORE|SERVER|SYSTEM/],
];

export function AuditCenter({audit,people}:Props){
  const [search,setSearch]=useState(''),[family,setFamily]=useState('all'),[period,setPeriod]=useState('30');
  const cutoff=period==='all'?0:Date.now()-Number(period)*86400000;
  const actorName=(a?:string)=>a?(people.get(a)||a):'Système';
  const rows=useMemo(()=>{
    const rule=families.find(f=>f[0]===family)?.[2]||/./;
    const q=search.trim().toLowerCase();
    return audit.filter(e=>{
      if(!rule.test(e.action))return false;
      if(cutoff&&Date.parse(e.timestamp)<cutoff)return false;
      return !q||[e.action,actorName(e.actor),e.role,e.details].join(' ').toLowerCase().includes(q);
    });
  },[audit,family,search,cutoff,people]);
  const sensitiveCount=rows.filter(e=>sensitive.test(e.action)).length;

  return <div className="stack">
    <div className="page-header"><div><h1>Journal d’audit</h1><p>Traçabilité des actions administratives, commerciales et de sécurité.</p></div>
      <div className="page-actions"><button className="btn" onClick={()=>csvDownload('abess-journal-audit.csv',[
        ['Date','Action','Acteur','Rôle','Détails'],...rows.map(e=>[e.timestamp,e.action,actorName(e.actor),e.role||'',e.details||''])
      ])}><Download size={14}/>Exporter CSV</button></div>
    </div>
    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><FileSearch size={14}/>Événements affichés</div><div className="metric-value">{rows.length}</div><div className="metric-foot">sur {audit.length} enregistrés</div></div>
      <div className="card metric-card"><div className="metric-label"><ShieldAlert size={14}/>Actions sensibles</div><div className="metric-value">{sensitiveCount}</div><div className="metric-foot">Suppressions, sécurité, paiements</div></div>
      <div className="card metric-card"><div className="metric-label">Acteurs distincts</div><div className="metric-value">{new Set(rows.map(e=>e.actor||'')).size}</div><div className="metric-foot">Sur la période filtrée</div></div>
      <div className="card metric-card"><div className="metric-label">Dernier événement</div><div className="metric-value" style={{fontSize:16}}>{rows[0]?fmtDateTime(rows[0].timestamp):'—'}</div><div className="metric-foot">{rows[0]?.action.replaceAll('_',' ')||'Aucun'}</div></div>
    </div>
    <section className="card card-pad">
      <div className="toolbar">
        <div className="search-wrap"><Search size={14}/><input className="search-input" placeholder="Action, acteur, détail…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="filter-pills">{families.map(([k,n])=><button key={k} className={'filter-pill '+(family===k?'active':'')} onClick={()=>setFamily(k)}>{n}</button>)}</div>
        <select className="select" aria-label="Période" value={period} onChange={e=>setPeriod(e.target.value)}><option value="1">24 heures</option><option value="7">7 jours</option><option value="30">30 jours</option><option value="all">Tout l’historique</option></select>
      </div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Action</th><th>Acteur</th><th>Détails</th></tr></thead>
        <tbody>{rows.slice(0,500).map(e=><tr key={e.id}>
          <td style={{whiteSpace:'nowrap'}}>{fmtDateTime(e.timestamp)}</td>
          <td><span className={'badge '+(sensitive.test(e.action)?'badge-warning':'badge-info')}>{e.action.replaceAll('_',' ')}</span></td>
          <td><div className="table-primary">{actorName(e.actor)}</div><div className="table-secondary">{e.role||''}</div></td>
          <td><div className="table-secondary audit-details">{String(e.details||'')}</div></td>
        </tr>)}</tbody></table></div>
      {rows.length>500&&<p className="card-subtitle" style={{marginTop:10}}>500 premiers événements affichés — affinez les filtres ou exportez le CSV complet.</p>}
      {!rows.length&&<div className="empty-state"><FileSearch size={24}/><strong>Aucun événement pour ce filtre</strong></div>}
    </section>
  </div>;
}

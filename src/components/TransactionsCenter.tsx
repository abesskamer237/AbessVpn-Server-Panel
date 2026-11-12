import {useMemo,useState} from 'react';
import {Download,Filter,Printer,ReceiptText} from 'lucide-react';
import type {Transaction} from '../panelTypes';
import {csvDownload,fmtDateTime} from '../panelTypes';

type Props={transactions:Transaction[]};
export function TransactionsCenter({transactions}:Props){
  const [search,setSearch]=useState('');
  const [type,setType]=useState('all');
  const [period,setPeriod]=useState('30');
  const cutoff=period==='all'?0:Date.now()-Number(period)*86400000;
  const types=Array.from(new Set(transactions.map(t=>t.type))).sort();
  const rows=useMemo(()=>transactions.filter(t=>{
    if(type!=='all'&&t.type!==type)return false;
    if(cutoff&&Date.parse(t.timestamp)<cutoff)return false;
    const q=search.trim().toLowerCase();
    return !q||[t.resellerName,t.type,t.note,String(t.amountGb)].join(' ').toLowerCase().includes(q);
  }),[transactions,search,type,period]);
  const volume=rows.reduce((n,t)=>n+Math.abs(Number(t.amountGb||0)),0);
  return <div className="stack">
    <div className="page-header"><div><h1>Transactions</h1><p>Journal commercial des crédits et ventes SSH-WSS.</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>window.print()}><Printer size={14}/>Imprimer / PDF</button>
        <button className="btn" onClick={()=>csvDownload('abess-transactions.csv',[
          ['Date','Revendeur','Type','Go','Solde avant','Solde après','Note'],
          ...rows.map(t=>[t.timestamp,t.resellerName,t.type,t.amountGb,t.balanceBefore,t.balanceAfter,t.note])
        ])}><Download size={14}/>CSV</button>
      </div>
    </div>
    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><ReceiptText size={14}/>Mouvements affichés</div><div className="metric-value">{rows.length}</div><div className="metric-foot">sur {transactions.length} entrées</div></div>
      <div className="card metric-card"><div className="metric-label"><Filter size={14}/>Volume de crédits</div><div className="metric-value">{volume.toFixed(1)} Go</div><div className="metric-foot">Somme absolue des mouvements filtrés</div></div>
      <div className="card metric-card"><div className="metric-label">Ventes SSH-WSS</div><div className="metric-value">{rows.filter(t=>t.type==='SSH_SALE').length}</div><div className="metric-foot">Créations facturées en crédits</div></div>
      <div className="card metric-card"><div className="metric-label">Renouvellements</div><div className="metric-value">{rows.filter(t=>t.type==='SSH_RENEW').length}</div><div className="metric-foot">Extensions quota/durée</div></div>
    </div>
    <section className="card card-pad">
      <div className="toolbar">
        <input className="search-input" type="search" placeholder="Rechercher revendeur, note, type…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <select className="select" value={type} onChange={e=>setType(e.target.value)}><option value="all">Tous les types</option>{types.map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select>
        <select className="select" value={period} onChange={e=>setPeriod(e.target.value)}><option value="7">7 jours</option><option value="30">30 jours</option><option value="90">90 jours</option><option value="all">Tout l’historique</option></select>
      </div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Revendeur</th><th>Action</th><th>Volume</th><th>Solde</th><th>Détail</th></tr></thead>
        <tbody>{rows.map(t=><tr key={t.id}><td>{fmtDateTime(t.timestamp)}</td><td><div className="table-primary">{t.resellerName}</div></td>
          <td><span className="badge badge-info">{t.type.replaceAll('_',' ')}</span></td><td>{Number(t.amountGb).toFixed(2)} Go</td>
          <td>{Number(t.balanceBefore).toFixed(2)} → {Number(t.balanceAfter).toFixed(2)} Go</td><td><div className="table-secondary">{t.note}</div></td></tr>)}</tbody>
      </table></div>
      {!rows.length&&<div className="empty-state"><ReceiptText size={24}/><strong>Aucune transaction pour ce filtre</strong></div>}
    </section>
  </div>;
}

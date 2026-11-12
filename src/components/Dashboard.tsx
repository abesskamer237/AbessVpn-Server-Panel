import {Activity,AlertTriangle,ArrowRight,CalendarClock,Radio,Server,Users,Wifi} from 'lucide-react';
import type {AuditEvent,OpsHealth,Reseller,SshInventory,Transaction} from '../panelTypes';
import {accountStatus,bytesToGb,fmtDateTime,percent} from '../panelTypes';

type Props={
  inventory:SshInventory|null;transactions:Transaction[];resellers:Reseller[];audit:AuditEvent[];
  ops:OpsHealth|null;onNavigate:(tab:string)=>void;
};

const compact=(n:number)=>new Intl.NumberFormat('fr-FR',{notation:'compact',maximumFractionDigits:1}).format(n);

export function Dashboard({inventory,transactions,resellers,audit,ops,onNavigate}:Props){
  const accounts=(inventory?.accounts||[]).filter(a=>a.managed);
  const active=accounts.filter(a=>accountStatus(a).key==='active').length;
  const expiring=accounts.filter(a=>accountStatus(a).key==='expiring').length;
  const sessions=accounts.reduce((n,a)=>n+(a.online||0),0);
  const used=accounts.reduce((n,a)=>n+(a.usedBytes||0),0);
  const quota=accounts.reduce((n,a)=>n+a.quotaBytes,0);
  const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
  const monthly=accounts.filter(a=>Date.parse(a.createdAt)>=monthStart).length;
  const nodes=inventory?.managedNodes||[];
  const onlineNodes=nodes.filter(n=>n.agentOnline).length;
  const alerts:{tone:'danger'|'warning'|'info',title:string,detail:string}[]=[];
  for(const n of nodes){
    if(!n.agentOnline)alerts.push({tone:'danger',title:n.name+' hors ligne',detail:'L’agent SSH-WSS ne répond plus.'});
    const t=n.hostTelemetry;
    if(t){
      if(!t.services.sshd||!t.services.gateway||!t.services.reconciler)
        alerts.push({tone:'danger',title:'Service SSH-WSS arrêté',detail:n.name+' signale un composant système inactif.'});
      if(t.totalMemoryBytes&&t.freeMemoryBytes/t.totalMemoryBytes<.1)
        alerts.push({tone:'warning',title:'Mémoire VPS faible',detail:n.name+' dispose de moins de 10 % de RAM libre.'});
      if(t.diskTotalBytes&&t.diskFreeBytes/t.diskTotalBytes<.1)
        alerts.push({tone:'warning',title:'Disque VPS presque plein',detail:n.name+' dispose de moins de 10 % d’espace libre.'});
    }
  }
  for(const a of accounts){
    const st=accountStatus(a);
    if(st.key==='quota')alerts.push({tone:'danger',title:a.label+' a épuisé son quota',detail:a.username});
    else if(st.key==='expiring')alerts.push({tone:'warning',title:a.label+' expire bientôt',detail:new Date(a.expiresAt).toLocaleDateString('fr-FR')});
    else if(st.key==='error')alerts.push({tone:'danger',title:'Erreur de provisionnement',detail:a.label+' · '+a.username});
  }
  if(ops?.alerts?.includes('BACKUP_OVERDUE'))alerts.push({tone:'warning',title:'Sauvegarde en retard',detail:'Aucune sauvegarde récente confirmée.'});
  if(ops?.alerts?.includes('LOW_DISK_SPACE'))alerts.push({tone:'danger',title:'Espace disque faible',detail:'Le conteneur API signale moins de 1 Go libre.'});
  const days=Array.from({length:7},(_,i)=>{
    const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(6-i));
    const start=d.getTime(),end=start+86400000;
    return {label:d.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''),value:accounts.filter(a=>{const t=Date.parse(a.createdAt);return t>=start&&t<end}).length};
  });
  const maxDay=Math.max(1,...days.map(d=>d.value));
  const recent=[...accounts].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,6);
  const resellerById=new Map(resellers.map(r=>[r.id,r]));
  let estimatedRevenue=0,estimatedCost=0;
  for(const a of accounts){
    const r=a.resellerId?resellerById.get(a.resellerId):undefined;
    if(!r)continue;
    const q=bytesToGb(a.quotaBytes);
    estimatedRevenue+=q*Number(r.pricePerGbCfa||0)+Number(r.pricePerLicenceCfa||0);
    estimatedCost+=q*Number(r.costPerGbCfa||0);
  }
  const estimatedMargin=estimatedRevenue-estimatedCost;
  const money=(n:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'XAF',maximumFractionDigits:0}).format(n||0);
  const credits=resellers.reduce((n,r)=>n+Number(r.credits||0),0);
  const recentActivity=audit.length?audit.slice(0,7):transactions.slice(0,7).map(t=>({id:t.id,timestamp:t.timestamp,action:t.type,details:t.note} as AuditEvent));

  return <div className="stack">
    <div className="page-header">
      <div><h1>Vue d’ensemble</h1><p>Activité commerciale et santé de l’infrastructure SSH-WSS.</p></div>
      <div className="page-actions">
        <button className="btn btn-primary" onClick={()=>onNavigate('clients')}><Users size={15}/>Nouveau client</button>
        <button className="btn" onClick={()=>onNavigate('servers')}><Server size={15}/>Voir les serveurs</button>
      </div>
    </div>

    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><Users size={14}/>Clients actifs</div><div className="metric-value">{active}</div><div className="metric-foot">+{monthly} ce mois · {accounts.length} licences au total</div></div>
      <div className="card metric-card"><div className="metric-label"><CalendarClock size={14}/>À renouveler</div><div className="metric-value">{expiring}</div><div className="metric-foot">Expiration dans les 3 prochains jours</div></div>
      <div className="card metric-card"><div className="metric-label"><Wifi size={14}/>Sessions en ligne</div><div className="metric-value">{sessions}</div><div className="metric-foot">{onlineNodes}/{nodes.length||0} VPS connectés</div></div>
      <div className="card metric-card"><div className="metric-label"><Activity size={14}/>Trafic consommé</div><div className="metric-value">{compact(bytesToGb(used))} Go</div><div className="metric-foot">{percent(used,quota)} % des quotas alloués</div></div>
    </div>

    <div className="grid-2">
      <section className="card card-pad">
        <div className="section-head"><div><h2>Activations des 7 derniers jours</h2><p>Nouveaux comptes SSH-WSS créés.</p></div><span className="badge badge-success">{monthly} ce mois</span></div>
        <div className="chart">
          {days.map(d=><div className="chart-column" key={d.label}><div className="chart-value">{d.value}</div><div className="chart-bar" style={{height:Math.max(4,(d.value/maxDay)*125)}}/><div className="chart-label">{d.label}</div></div>)}
        </div>
      </section>
      <section className="card card-pad">
        <div className="section-head"><div><h2>À traiter</h2><p>Éléments nécessitant une action.</p></div><span className={alerts.length?'badge badge-warning':'badge badge-success'}>{alerts.length||'RAS'}</span></div>
        <div className="alert-list">
          {!alerts.length&&<div className="empty-state"><Radio size={22}/><strong>Aucune alerte importante</strong><span>Les licences et agents sont dans un état normal.</span></div>}
          {alerts.slice(0,6).map((a,i)=><div className="alert-row" key={i}><span className="alert-dot" style={{background:a.tone==='danger'?'var(--danger)':a.tone==='warning'?'var(--warning)':'var(--info)'}}/><div><p>{a.title}</p><span>{a.detail}</span></div></div>)}
        </div>
      </section>
    </div>

    <div className="grid-equal">
      <section className="card card-pad">
        <div className="section-head"><div><h2>Performance commerciale</h2><p>Estimations basées sur les tarifs configurés par revendeur.</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('resellers')}>Tarifs <ArrowRight size={13}/></button></div>
        <div className="detail-grid">
          <div className="detail-item"><label>Chiffre d’affaires estimé</label><strong>{money(estimatedRevenue)}</strong></div>
          <div className="detail-item"><label>Marge estimée</label><strong>{money(estimatedMargin)}</strong></div>
          <div className="detail-item"><label>Crédits en circulation</label><strong>{credits.toFixed(2)} Go</strong></div>
          <div className="detail-item"><label>Revendeurs actifs</label><strong>{resellers.filter(r=>r.status==='active').length}</strong></div>
        </div>
      </section>
      <section className="card card-pad">
        <div className="section-head"><div><h2>État réseau</h2><p>Disponibilité des nœuds et capacité allouée.</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('servers')}>Serveurs <ArrowRight size={13}/></button></div>
        <div className="service-line"><span>Agents connectés</span><strong>{onlineNodes} / {nodes.length}</strong></div>
        <div className="service-line"><span>Sessions actives</span><strong>{sessions}</strong></div>
        <div className="service-line"><span>Quota total alloué</span><strong>{compact(bytesToGb(quota))} Go</strong></div>
        <div className="service-line"><span>Quota consommé</span><strong>{percent(used,quota)} %</strong></div>
      </section>
    </div>

    <div className="grid-equal">
      <section className="card card-pad">
        <div className="section-head"><div><h2>Derniers clients</h2><p>Les activations SSH-WSS les plus récentes.</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('clients')}>Tout voir <ArrowRight size={13}/></button></div>
        {recent.length?<div className="data-table-wrap"><table className="data-table" style={{minWidth:0}}><tbody>
          {recent.map(a=>{const st=accountStatus(a);return <tr key={a.id}><td><div className="table-primary">{a.label}</div><div className="table-secondary">{a.username}</div></td><td><span className={'badge badge-'+st.tone}>{st.label}</span></td><td><div className="table-secondary">{a.resellerName||'Administration'}</div></td></tr>})}
        </tbody></table></div>:<div className="empty-state"><Users size={22}/><strong>Aucun client</strong><span>Crée ta première licence SSH-WSS.</span></div>}
      </section>
      <section className="card card-pad">
        <div className="section-head"><div><h2>Activité récente</h2><p>Actions administratives et commerciales.</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('transactions')}>Registre <ArrowRight size={13}/></button></div>
        <div className="alert-list">
          {recentActivity.length?recentActivity.map(x=><div className="alert-row" key={x.id}><span className="alert-dot" style={{background:'var(--brand)'}}/><div><p>{x.action.replaceAll('_',' ')}</p><span>{fmtDateTime(x.timestamp)}{x.details?' · '+String(x.details).slice(0,90):''}</span></div></div>):<div className="empty-state"><AlertTriangle size={22}/><strong>Pas encore d’activité</strong></div>}
        </div>
      </section>
    </div>
  </div>;
}

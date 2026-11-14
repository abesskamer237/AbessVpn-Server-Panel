import {Activity,ArrowRight,CalendarClock,CreditCard,History,Plus,Radio,ReceiptText,Server,UserPlus,Users,Wallet,Wifi} from 'lucide-react';
import type {AuditEvent,OpsHealth,Reseller,Role,SshInventory,Transaction,User} from '../panelTypes';
import {accountStatus,bytesToGb,fmtDateTime,money,percent} from '../panelTypes';

type Props={
  inventory:SshInventory|null;transactions:Transaction[];resellers:Reseller[];audit:AuditEvent[];
  ops:OpsHealth|null;role:Role;user:User;onNavigate:(tab:string)=>void;onCreateClient:()=>void;
};
type Alert={tone:'danger'|'warning'|'info';title:string;detail:string;tab:string};

const compact=(n:number)=>new Intl.NumberFormat('fr-FR',{notation:'compact',maximumFractionDigits:1}).format(n);
const toneColor=(t:Alert['tone'])=>t==='danger'?'var(--danger)':t==='warning'?'var(--warning)':'var(--info)';

/** Smooth area chart drawn in SVG: no chart library, crisp at any size. */
function AreaChart({points}:{points:{label:string;value:number}[]}){
  const w=640,h=230,top=10;
  const max=Math.max(4,...points.map(p=>p.value));
  const step=w/Math.max(1,points.length-1);
  const xy=points.map((p,i)=>[i*step,top+(h-top)*(1-p.value/max)] as const);
  const path=xy.map(([x,y],i)=>{
    if(!i)return `M${x},${y}`;
    const [px,py]=xy[i-1],cx=(px+x)/2;
    return `C${cx},${py} ${cx},${y} ${x},${y}`;
  }).join(' ');
  return <div>
    <div style={{position:'relative'}}>
      <svg className="chart-svg" style={{height:h}} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Activations par jour">
        <defs><linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".26"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>
        {[0,.5,1].map(f=><line key={f} className="grid-line" x1={0} x2={w} y1={top+(h-top)*f} y2={top+(h-top)*f} vectorEffect="non-scaling-stroke" strokeDasharray={f===1?undefined:'3 4'}/>)}
        <path className="area" d={`${path} L${w},${h} L0,${h} Z`}/>
        <path className="line" d={path} vectorEffect="non-scaling-stroke"/>
      </svg>
      <span className="table-secondary" style={{position:'absolute',left:0,top:-2}}>{max}</span>
    </div>
    <div style={{display:'flex',justifyContent:'space-between',marginTop:6}}>{points.map((p,i)=><span key={i} className="table-secondary num" style={{width:0,display:'flex',justifyContent:'center',whiteSpace:'nowrap'}}>{p.label}</span>)}</div>
  </div>;
}

export function Dashboard({inventory,transactions,resellers,audit,ops,role,user,onNavigate,onCreateClient}:Props){
  const isSuper=role==='SUPER_ADMIN';
  const accounts=(inventory?.accounts||[]).filter(a=>a.managed);
  const statuses=accounts.map(a=>accountStatus(a).key);
  const count=(k:string)=>statuses.filter(s=>s===k).length;
  const active=count('active'),expiring=count('expiring');
  const sessions=accounts.reduce((n,a)=>n+(a.online||0),0);
  const capacity=accounts.reduce((n,a)=>n+a.maxConnections,0);
  const used=accounts.reduce((n,a)=>n+(a.usedBytes||0),0);
  const quota=accounts.reduce((n,a)=>n+a.quotaBytes,0);
  const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
  const monthly=accounts.filter(a=>Date.parse(a.createdAt)>=monthStart).length;
  const nodes=inventory?.managedNodes||[];
  const onlineNodes=nodes.filter(n=>n.agentOnline).length;

  const alerts:Alert[]=[];
  for(const n of nodes){
    if(!n.agentOnline)alerts.push({tone:'danger',title:n.name+' hors ligne',detail:'L’agent SSH-WSS ne répond plus.',tab:'servers'});
    const t=n.hostTelemetry;
    if(t){
      if(!t.services.sshd||!t.services.gateway||!t.services.reconciler)alerts.push({tone:'danger',title:'Service SSH-WSS arrêté',detail:n.name,tab:'servers'});
      if(t.totalMemoryBytes&&t.freeMemoryBytes/t.totalMemoryBytes<.1)alerts.push({tone:'warning',title:'Mémoire VPS faible',detail:n.name+' · < 10 % libre',tab:'servers'});
      if(t.diskTotalBytes&&t.diskFreeBytes/t.diskTotalBytes<.1)alerts.push({tone:'warning',title:'Disque VPS presque plein',detail:n.name+' · < 10 % libre',tab:'servers'});
    }
  }
  for(const a of accounts){
    const st=accountStatus(a);
    if(st.key==='quota')alerts.push({tone:'danger',title:a.label+' · quota épuisé',detail:a.username,tab:'clients'});
    else if(st.key==='expiring')alerts.push({tone:'warning',title:a.label+' expire bientôt',detail:new Date(a.expiresAt).toLocaleDateString('fr-FR'),tab:'clients'});
    else if(st.key==='error')alerts.push({tone:'danger',title:'Erreur de provisionnement',detail:a.label,tab:'clients'});
  }
  if(ops?.alerts?.includes('BACKUP_OVERDUE'))alerts.push({tone:'warning',title:'Sauvegarde en retard',detail:'Aucune sauvegarde récente confirmée.',tab:'servers'});
  if(ops?.alerts?.includes('LOW_DISK_SPACE'))alerts.push({tone:'danger',title:'Espace disque API faible',detail:'Moins de 1 Go libre.',tab:'servers'});

  const days=Array.from({length:14},(_,i)=>{
    const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(13-i));
    const start=d.getTime(),end=start+86400000;
    return {label:i%2?'':d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}),value:accounts.filter(a=>{const t=Date.parse(a.createdAt);return t>=start&&t<end}).length};
  });
  const last7=days.slice(7).reduce((n,d)=>n+d.value,0),prev7=days.slice(0,7).reduce((n,d)=>n+d.value,0);
  const trend=prev7?Math.round((last7-prev7)/prev7*100):last7?100:0;

  const resellerById=new Map(resellers.map(r=>[r.id,r]));
  let revenue=0,cost=0;
  for(const a of accounts){
    const r=a.resellerId?resellerById.get(a.resellerId):undefined;if(!r)continue;
    const q=bytesToGb(a.quotaBytes);revenue+=q*Number(r.pricePerGbCfa||0)+Number(r.pricePerLicenceCfa||0);cost+=q*Number(r.costPerGbCfa||0);
  }
  const credits=resellers.reduce((n,r)=>n+Number(r.credits||0),0);
  const sales=transactions.filter(t=>t.type==='SSH_SALE'||t.type==='SSH_RENEW');
  const salesMonth=sales.filter(t=>Date.parse(t.timestamp)>=monthStart);
  const recent=[...accounts].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,6);
  const activity=audit.length?audit.slice(0,6):transactions.slice(0,6).map(t=>({id:t.id,timestamp:t.timestamp,action:t.type,details:t.note} as AuditEvent));
  const statusMix=[['Actifs',active,'var(--success)'],['À renouveler',expiring,'var(--warning)'],['Suspendus',count('suspended'),'var(--muted)'],['Quota épuisé',count('quota'),'var(--danger)'],['Expirés',count('expired'),'var(--muted-2)']] as const;
  const total=Math.max(1,accounts.length);
  const firstName=user.name.split(' ')[0]||user.name;

  return <div className="stack">
    <div className="page-header">
      <div><h1>Vue d’ensemble</h1><p>Bonjour {firstName} — activité commerciale et santé de l’infrastructure SSH-WSS.</p></div>
      <div className="page-actions">
        {isSuper?<button className="btn" onClick={()=>onNavigate('servers')}><Server size={14}/>Voir les serveurs</button>
          :role==='RESELLER'?<button className="btn" onClick={()=>onNavigate('resellers')}><UserPlus size={14}/>Mes sous-revendeurs</button>
          :<button className="btn" onClick={()=>onNavigate('billing')}><Wallet size={14}/>Facturation</button>}
        <button className="btn btn-primary" onClick={onCreateClient}><Plus size={14}/>Nouveau client</button>
      </div>
    </div>

    {role==='RESELLER'&&<div className="balance-card">
      <div><div className="bc-label">Votre solde de crédits</div><div className="bc-value">{Number(user.credits||0).toFixed(2)} Go</div>
        <div className="bc-label">{Number(user.credits||0)<5?'Solde faible : rechargez pour continuer à créer et renouveler vos clients.':'Chaque Go de quota vendu ou renouvelé est débité de ce solde.'}</div></div>
      <div className="row-actions"><button className="btn" onClick={()=>onNavigate('transactions')}><History size={14}/>Historique</button><button className="btn btn-primary" onClick={()=>onNavigate('billing')}><Wallet size={14}/>Acheter des crédits</button></div>
    </div>}

    {/* Group 1 — activity KPIs in one strip */}
    <div className="metric-grid">
      <div className="metric-card"><div className="metric-label"><Users size={13}/>Clients actifs</div><div className="metric-value">{active}{(last7||prev7)>0&&<span className={'metric-trend '+(trend>=0?'up':'down')}>{trend>=0?'+':''}{trend}%</span>}</div><div className="metric-foot">{accounts.length} licences · +{monthly} ce mois</div></div>
      <div className="metric-card"><div className="metric-label"><CalendarClock size={13}/>À renouveler</div><div className="metric-value">{expiring}</div><div className="metric-foot">Expiration sous 3 jours</div></div>
      <div className="metric-card"><div className="metric-label"><Wifi size={13}/>Sessions en ligne</div><div className="metric-value">{sessions}<span className="table-secondary" style={{fontSize:13,marginLeft:4}}>/ {capacity}</span></div><div className="metric-foot">{onlineNodes}/{nodes.length} VPS connectés</div></div>
      <div className="metric-card"><div className="metric-label"><Activity size={13}/>Trafic consommé</div><div className="metric-value">{compact(bytesToGb(used))} Go</div><div className="metric-foot">{percent(used,quota)} % de {compact(bytesToGb(quota))} Go alloués</div></div>
    </div>

    <div className="bento">
      {/* Group 2 — growth chart + action queue */}
      <section className="card card-pad span-8">
        <div className="section-head"><div><h2>Activations</h2><p>Nouveaux comptes SSH-WSS sur 14 jours</p></div>
          <div className="chart-legend"><span>7 derniers jours <b>{last7}</b></span><span>Précédents <b>{prev7}</b></span></div></div>
        <AreaChart points={days}/>
      </section>
      <section className="card card-pad span-4">
        <div className="section-head"><div><h2>À traiter</h2><p>Éléments nécessitant une action</p></div><span className={'badge '+(alerts.length?'badge-warning':'badge-success')}>{alerts.length||'RAS'}</span></div>
        {!alerts.length?<div className="empty-state"><Radio size={20}/><strong>Aucune alerte</strong><span>Licences et agents dans un état normal.</span></div>
          :<div className="alert-list">{alerts.slice(0,6).map((a,i)=><button key={i} className="alert-row" style={{width:'100%',background:'none',border:0,borderBottom:'1px solid var(--line)',textAlign:'left',color:'inherit'}} onClick={()=>onNavigate(a.tab)}><span className="alert-dot" style={{background:toneColor(a.tone)}}/><div><p>{a.title}</p><span>{a.detail}</span></div><ArrowRight size={13} color="var(--muted)"/></button>)}</div>}
      </section>

      {/* Group 3 — three operational tiles of the same shape */}
      <section className="card card-pad span-4">
        <div className="section-head"><div><h2>Portefeuille clients</h2><p>Répartition par état</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('clients')}>Clients <ArrowRight size={12}/></button></div>
        <div className="ring-row" style={{marginBottom:12}}>
          <div className="ring" style={{['--p' as any]:Math.round(active/total*100)}}><span>{Math.round(active/total*100)}%</span></div>
          <div className="kv-inline" style={{flexDirection:'column',gap:2}}><span>Taux d’activité</span><b style={{fontSize:16}}>{active} / {accounts.length}</b></div>
        </div>
        {statusMix.map(([label,value,color])=><div className="service-line" key={label}><span style={{display:'flex',alignItems:'center',gap:8}}><span className="alert-dot" style={{background:color}}/>{label}</span><strong>{value}</strong></div>)}
      </section>
      <section className="card card-pad span-4">
        <div className="section-head"><div><h2>Commerce</h2><p>Estimations selon les tarifs revendeurs</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('billing')}>Facturation <ArrowRight size={12}/></button></div>
        <div className="detail-grid">
          <div className="detail-item"><label>CA estimé</label><strong>{money(revenue)}</strong></div>
          <div className="detail-item"><label>Marge estimée</label><strong>{money(revenue-cost)}</strong></div>
          <div className="detail-item"><label>Ventes ce mois</label><strong>{salesMonth.length}</strong></div>
          <div className="detail-item"><label>{isSuper||role==='ADMIN'?'Crédits en circulation':'Votre solde'}</label><strong>{(isSuper||role==='ADMIN'?credits:Number(user.credits||0)).toFixed(2)} Go</strong></div>
        </div>
        <div className="service-line" style={{marginTop:6}}><span>Revendeurs actifs</span><strong>{resellers.filter(r=>r.status==='active').length} / {resellers.length}</strong></div>
      </section>
      {role==='RESELLER'?<section className="card card-pad span-4">
        <div className="section-head"><div><h2>Actions rapides</h2><p>Les opérations les plus fréquentes</p></div></div>
        <div className="quick-grid">
          <button className="quick-action" onClick={onCreateClient}><span className="qa-icon"><Plus size={14}/></span><span><strong>Nouveau client</strong><span>Licence SSH-WSS</span></span></button>
          <button className="quick-action" onClick={()=>onNavigate('clients')}><span className="qa-icon"><CalendarClock size={14}/></span><span><strong>Renouveler</strong><span>{expiring} à renouveler</span></span></button>
          <button className="quick-action" onClick={()=>onNavigate('resellers')}><span className="qa-icon"><UserPlus size={14}/></span><span><strong>Sous-revendeur</strong><span>Créer ou créditer</span></span></button>
          <button className="quick-action" onClick={()=>onNavigate('billing')}><span className="qa-icon"><ReceiptText size={14}/></span><span><strong>Crédits</strong><span>Commander, payer</span></span></button>
        </div>
        <div className="service-line" style={{marginTop:8}}><span>Serveurs disponibles</span><strong>{onlineNodes} / {nodes.length}</strong></div>
      </section>:<section className="card card-pad span-4">
        <div className="section-head"><div><h2>Infrastructure</h2><p>Nœuds et capacité</p></div>{isSuper&&<button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('servers')}>Serveurs <ArrowRight size={12}/></button>}</div>
        <div className="stack" style={{gap:10}}>
          <div className="meter"><div className="meter-head"><span>Agents connectés</span><b>{onlineNodes} / {nodes.length}</b></div><div className="progress"><span style={{width:percent(onlineNodes,nodes.length)+'%'}}/></div></div>
          <div className="meter"><div className="meter-head"><span>Sessions utilisées</span><b>{sessions} / {capacity}</b></div><div className="progress"><span style={{width:percent(sessions,capacity)+'%'}}/></div></div>
          <div className="meter"><div className="meter-head"><span>Quota consommé</span><b>{percent(used,quota)} %</b></div><div className={'progress '+(percent(used,quota)>85?'warning':'')}><span style={{width:percent(used,quota)+'%'}}/></div></div>
          {isSuper&&<div className="service-line"><span>Stockage</span><strong>{ops?.storage||'—'}</strong></div>}
        </div>
      </section>}

      {/* Group 4 — two lists of the same shape */}
      <section className="card span-6">
        <div className="panel-head"><div><h2>Derniers clients</h2><p>Activations les plus récentes</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate('clients')}>Tout voir <ArrowRight size={12}/></button></div>
        <div className="panel-body" style={{paddingTop:4,paddingBottom:4}}>
          {recent.length?<div className="alert-list">{recent.map(a=>{const st=accountStatus(a);return <div className="alert-row" key={a.id}>
            <div className="avatar" style={{width:26,height:26,fontSize:11}}>{a.label.slice(0,1).toUpperCase()}</div>
            <div><p>{a.label}</p><span className="mono">{a.username} · {a.resellerName||'Administration'}</span></div>
            <span className={'badge badge-'+st.tone}>{st.label}</span></div>})}</div>
          :<div className="empty-state"><Users size={20}/><strong>Aucun client</strong><span>Créez votre première licence SSH-WSS.</span><button className="btn btn-sm btn-primary" style={{marginTop:8}} onClick={onCreateClient}><Plus size={13}/>Nouveau client</button></div>}
        </div>
      </section>
      <section className="card span-6">
        <div className="panel-head"><div><h2>Activité récente</h2><p>Actions administratives et commerciales</p></div><button className="btn btn-sm btn-ghost" onClick={()=>onNavigate(isSuper?'audit':'transactions')}>{isSuper?'Journal':'Registre'} <ArrowRight size={12}/></button></div>
        <div className="panel-body" style={{paddingTop:4,paddingBottom:4}}>
          {activity.length?<div className="alert-list">{activity.map(x=><div className="alert-row" key={x.id}>
            <div className="avatar" style={{width:26,height:26,color:'var(--muted)'}}>{/SALE|RENEW|CREDIT|PAYMENT/.test(x.action)?<ReceiptText size={13}/>:/RESELLER/.test(x.action)?<CreditCard size={13}/>:<Activity size={13}/>}</div>
            <div><p>{x.action.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase())}</p><span>{fmtDateTime(x.timestamp)}{x.details?' · '+String(x.details).slice(0,80):''}</span></div></div>)}</div>
          :<div className="empty-state"><Activity size={20}/><strong>Pas encore d’activité</strong></div>}
        </div>
      </section>
    </div>
  </div>;
}

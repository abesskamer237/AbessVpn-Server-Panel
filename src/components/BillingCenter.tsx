import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {BadgeCheck,Ban,CheckCircle2,Clock3,Copy,Edit3,FileText,Package,Plus,Printer,ReceiptText,Search,ShoppingCart,Trash2,Wallet,X} from 'lucide-react';
import type {Order,OrdersPayload,PaymentContact,Plan,Role,User} from '../panelTypes';
import {csvDownload,fmtDateTime,money} from '../panelTypes';

type Props={
  currentUser:User;role:Role;
  request:(url:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<any>;
  onCreditsChanged:()=>Promise<void>;
};

const statusMeta:Record<Order['status'],{label:string;tone:string}>={
  pending:{label:'En attente de paiement',tone:'neutral'},
  submitted:{label:'Paiement déclaré',tone:'info'},
  paid:{label:'Payée',tone:'success'},
  rejected:{label:'Refusée',tone:'danger'},
  cancelled:{label:'Annulée',tone:'neutral'},
};
const channelLabel=(c?:string)=>c==='MOMO'?'MTN MoMo':c==='OM'?'Orange Money':'—';
const newKey=()=>crypto.randomUUID().replaceAll('-','');

function escapeHtml(value:unknown){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

export function BillingCenter({currentUser,role,request,onCreditsChanged}:Props){
  const isSuper=role==='SUPER_ADMIN';
  const [plans,setPlans]=useState<Plan[]>([]);
  const [data,setData]=useState<OrdersPayload|null>(null);
  const [error,setError]=useState(''),[success,setSuccess]=useState('');
  const [working,setWorking]=useState(false);
  const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|Order['status']>(isSuper?'submitted':'all');
  const [declare,setDeclare]=useState<Order|null>(null);
  const [declareChannel,setDeclareChannel]=useState<'MOMO'|'OM'>('MOMO'),[declareRef,setDeclareRef]=useState('');
  const [review,setReview]=useState<Order|null>(null);
  const [reviewChannel,setReviewChannel]=useState<'MOMO'|'OM'>('MOMO'),[reviewRef,setReviewRef]=useState(''),[reviewAmount,setReviewAmount]=useState(0),[reviewChecked,setReviewChecked]=useState(false);
  const [rejectReason,setRejectReason]=useState('');
  const [planForm,setPlanForm]=useState<Partial<Plan>&{open:boolean}|null>(null);
  const intents=useRef<Record<string,string>>({});

  async function load(){
    const [offers,orders]=await Promise.all([request('/api/v1/plans'),request('/api/v1/commerce/orders')]);
    setPlans((Array.isArray(offers)?offers:offers.plans||[]).filter((p:Plan)=>p&&p.id));
    setData(orders);
  }
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Chargement impossible'))},[]);

  async function run(work:()=>Promise<void|string>){
    setWorking(true);setError('');setSuccess('');
    try{const msg=await work();await load();if(typeof msg==='string')setSuccess(msg)}
    catch(e){setError(e instanceof Error?e.message:'Opération impossible')}
    finally{setWorking(false)}
  }

  const orders=data?.orders||[];
  const contacts:PaymentContact[]=data?.contacts||[];
  const filtered=useMemo(()=>orders.filter(o=>{
    if(filter!=='all'&&o.status!==filter)return false;
    const q=search.trim().toLowerCase();
    return !q||[o.id,o.planName,o.customerName,o.claimedReference,o.verifiedReference,o.invoiceNumber].join(' ').toLowerCase().includes(q);
  }).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),[orders,filter,search]);

  const paid=orders.filter(o=>o.status==='paid');
  const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);
  const revenueMonth=paid.filter(o=>Date.parse(o.paidAt||'')>=monthStart.getTime()).reduce((n,o)=>n+o.amount,0);
  const revenueTotal=paid.reduce((n,o)=>n+o.amount,0);
  const toVerify=orders.filter(o=>o.status==='submitted');
  const sellablePlans=plans.filter(p=>Number(p.priceCfa)>0);

  async function order(plan:Plan){
    await run(async()=>{
      const key=intents.current[plan.id]||(intents.current[plan.id]=newKey());
      const created:Order=await request('/api/v1/commerce/orders','POST',{planId:plan.id},{'Idempotency-Key':key});
      delete intents.current[plan.id];
      setDeclare(created);setDeclareRef('');
      return 'Commande créée. Effectuez le transfert puis déclarez la référence.';
    });
  }
  async function submitDeclaration(e:FormEvent){
    e.preventDefault();if(!declare)return;
    await run(async()=>{
      await request('/api/v1/commerce/orders/'+declare.id+'/submit','POST',{channel:declareChannel,reference:declareRef.trim()});
      setDeclare(null);
      return 'Paiement déclaré. Les crédits seront ajoutés après vérification par l’administrateur.';
    });
  }
  function openReview(o:Order){
    setReview(o);setReviewChannel((o.channel as 'MOMO'|'OM')||'MOMO');setReviewRef(o.claimedReference||'');setReviewAmount(o.amount);setReviewChecked(false);setRejectReason('');
  }
  async function confirm(e:FormEvent){
    e.preventDefault();if(!review)return;
    await run(async()=>{
      await request('/api/v1/commerce/orders/'+review.id+'/confirm','POST',{confirmedReceived:reviewChecked,channel:reviewChannel,reference:reviewRef.trim(),receivedAmount:Math.round(reviewAmount)});
      setReview(null);await onCreditsChanged();
      return 'Paiement confirmé : '+review.quotaGb+' Go crédités à '+(review.customerName||'ce compte')+'.';
    });
  }
  async function reject(){
    if(!review)return;
    await run(async()=>{
      await request('/api/v1/commerce/orders/'+review.id+'/reject','POST',{reason:rejectReason.trim()});
      setReview(null);return 'Déclaration refusée.';
    });
  }
  async function printInvoice(o:Order){
    const view=window.open('','_blank');
    if(!view){setError('Autorisez les fenêtres pop-up pour imprimer la facture.');return}
    view.opener=null;
    try{
      const inv=await request('/api/v1/commerce/orders/'+o.id+'/invoice');
      const rows=(inv.items||[]).map((i:any)=>`<tr><td>${escapeHtml(i.description)}</td><td>${escapeHtml(i.creditsGb)} Go</td><td>${escapeHtml(i.quantity)}</td><td class="r">${escapeHtml(money(i.amount))}</td></tr>`).join('');
      view.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Facture ${escapeHtml(inv.number)}</title><style>
        body{font-family:Inter,system-ui,sans-serif;color:#101828;margin:40px;font-size:13px}h1{font-size:22px;margin:0}
        .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #079455;padding-bottom:16px;margin-bottom:24px}
        .muted{color:#667085}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:10px;border-bottom:1px solid #e4e7ec;text-align:left}
        th{background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#667085}.r{text-align:right}
        .total{font-size:16px;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.foot{margin-top:28px;font-size:11px;color:#667085}
        @media print{button{display:none}}</style></head><body>
        <div class="top"><div><h1>${escapeHtml(inv.seller?.name||'ABESS VPN')}</h1><div class="muted">${escapeHtml(inv.seller?.address||'')}</div>${inv.seller?.taxId?`<div class="muted">NIU : ${escapeHtml(inv.seller.taxId)}</div>`:''}</div>
        <div style="text-align:right"><div style="font-size:18px;font-weight:800">FACTURE</div><div>N° ${escapeHtml(inv.number)}</div><div class="muted">${escapeHtml(new Date(inv.date).toLocaleDateString('fr-FR'))}</div></div></div>
        <div class="grid"><div><div class="muted">Facturé à</div><strong>${escapeHtml(inv.customer?.name||'')}</strong><div>${escapeHtml(inv.customer?.email||'')}</div></div>
        <div><div class="muted">Règlement</div><strong>${escapeHtml(channelLabel(inv.paymentChannel))}</strong><div>Réf. ${escapeHtml(inv.paymentReference||'')}</div></div></div>
        <table><thead><tr><th>Désignation</th><th>Crédits</th><th>Qté</th><th class="r">Montant</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3" class="r total">Total</td><td class="r total">${escapeHtml(money(inv.total))}</td></tr></tfoot></table>
        <p class="foot">${escapeHtml(inv.confirmation||'')} · ${escapeHtml(inv.taxNotice||'')}</p>
        <button onclick="window.print()" style="margin-top:16px;padding:10px 16px">Imprimer / PDF</button></body></html>`);
      view.document.close();
    }catch(e){view.close();setError(e instanceof Error?e.message:'Facture indisponible')}
  }
  async function savePlan(e:FormEvent){
    e.preventDefault();if(!planForm)return;
    await run(async()=>{
      const body={name:planForm.name,quotaGb:Number(planForm.quotaGb),durationDays:Number(planForm.durationDays),priceCfa:Math.round(Number(planForm.priceCfa||0)),badge:planForm.badge||'',description:planForm.description||''};
      if(planForm.id)await request('/api/v1/admin/plans/'+planForm.id,'PUT',body);
      else await request('/api/v1/admin/plans','POST',body);
      setPlanForm(null);return 'Offre enregistrée.';
    });
  }

  const filters:[typeof filter,string,number][]=[
    ['all','Toutes',orders.length],['submitted','À vérifier',toVerify.length],['pending','En attente',orders.filter(o=>o.status==='pending').length],
    ['paid','Payées',paid.length],['rejected','Refusées',orders.filter(o=>o.status==='rejected').length],
  ];

  return <div className="stack">
    <div className="page-header">
      <div><h1>Facturation</h1><p>{isSuper?'Offres de crédits, encaissements Mobile Money et factures.':'Achetez des crédits, suivez vos paiements et téléchargez vos factures.'}</p></div>
      <div className="page-actions">
        <button className="btn" onClick={()=>csvDownload('abess-commandes.csv',[
          ['Date','Commande','Client','Offre','Crédits Go','Montant XAF','Statut','Canal','Référence','Facture'],
          ...filtered.map(o=>[o.createdAt,o.id,o.customerName||'',o.planName,o.quotaGb,o.amount,statusMeta[o.status]?.label||o.status,channelLabel(o.channel),o.verifiedReference||o.claimedReference||'',o.invoiceNumber||''])
        ])}><FileText size={14}/>Exporter CSV</button>
        {isSuper&&<button className="btn btn-primary" onClick={()=>setPlanForm({open:true,name:'',quotaGb:10,durationDays:30,priceCfa:1000})}><Plus size={15}/>Nouvelle offre</button>}
      </div>
    </div>

    {error&&<p className="notice" role="alert">{error}</p>}
    {success&&<p className="notice notice-success" role="status">{success}</p>}

    <div className="metric-grid">
      {isSuper?<>
        <div className="card metric-card"><div className="metric-label"><Clock3 size={14}/>À vérifier</div><div className="metric-value">{toVerify.length}</div><div className="metric-foot">Déclarations de paiement en attente</div></div>
        <div className="card metric-card"><div className="metric-label"><Wallet size={14}/>Encaissé ce mois</div><div className="metric-value">{money(revenueMonth)}</div><div className="metric-foot">Paiements confirmés manuellement</div></div>
        <div className="card metric-card"><div className="metric-label"><ReceiptText size={14}/>Encaissé au total</div><div className="metric-value">{money(revenueTotal)}</div><div className="metric-foot">{paid.length} facture(s) émise(s)</div></div>
        <div className="card metric-card"><div className="metric-label"><Package size={14}/>Offres actives</div><div className="metric-value">{sellablePlans.length}</div><div className="metric-foot">Packs de crédits proposés</div></div>
      </>:<>
        <div className="card metric-card"><div className="metric-label"><Wallet size={14}/>Votre solde</div><div className="metric-value">{Number(currentUser.credits||0).toFixed(2)} Go</div><div className="metric-foot">Crédits disponibles pour vos clients</div></div>
        <div className="card metric-card"><div className="metric-label"><Clock3 size={14}/>En vérification</div><div className="metric-value">{toVerify.length}</div><div className="metric-foot">Paiements déclarés</div></div>
        <div className="card metric-card"><div className="metric-label"><ReceiptText size={14}/>Factures</div><div className="metric-value">{paid.length}</div><div className="metric-foot">Commandes payées</div></div>
        <div className="card metric-card"><div className="metric-label"><Package size={14}/>Total investi</div><div className="metric-value">{money(revenueTotal)}</div><div className="metric-foot">Achats de crédits confirmés</div></div>
      </>}
    </div>

    <section className="card card-pad">
      <div className="section-head"><div><h2>{isSuper?'Catalogue des offres':'Acheter des crédits'}</h2><p>{isSuper?'Les revendeurs commandent ces packs ; les crédits sont ajoutés après votre vérification.':'Choisissez un pack, payez par Mobile Money puis déclarez la référence du transfert.'}</p></div><ShoppingCart size={18}/></div>
      {plans.length?<div className="plan-grid">{plans.map(p=><article className={'plan-card'+(p.badge?' featured':'')} key={p.id}>
        {p.badge&&<span className="plan-badge">{p.badge}</span>}
        <div className="plan-name">{p.name}</div>
        <div className="plan-price">{Number(p.priceCfa)>0?money(p.priceCfa):'Non vendue'}</div>
        <div className="plan-meta">{p.quotaGb} Go de crédits · {p.durationDays} jours</div>
        {Number(p.priceCfa)>0&&<div className="plan-meta">{money(Number(p.priceCfa)/Math.max(Number(p.quotaGb),0.01))} / Go</div>}
        {p.description&&<p className="plan-desc">{p.description}</p>}
        <div className="row-actions" style={{marginTop:'auto'}}>
          {!isSuper&&<button className="btn btn-primary" style={{width:'100%'}} disabled={working||Number(p.priceCfa)<=0} onClick={()=>void order(p)}><ShoppingCart size={14}/>Commander</button>}
          {isSuper&&<><button className="btn btn-sm" onClick={()=>setPlanForm({open:true,...p})}><Edit3 size={13}/>Modifier</button>
            <button className="btn btn-sm btn-danger" disabled={working} onClick={()=>{if(window.confirm('Supprimer l’offre « '+p.name+' » ?'))void run(async()=>{await request('/api/v1/admin/plans/'+p.id,'DELETE');return 'Offre supprimée.'})}}><Trash2 size={13}/>Supprimer</button></>}
        </div>
      </article>)}</div>:<div className="empty-state"><Package size={24}/><strong>Aucune offre publiée</strong><span>{isSuper?'Créez votre premier pack de crédits.':'L’administrateur n’a pas encore publié d’offre.'}</span></div>}
    </section>

    {!isSuper&&contacts.length>0&&<section className="card card-pad">
      <div className="section-head"><div><h2>Coordonnées de paiement</h2><p>Vérifiez toujours le nom du bénéficiaire avant de valider le transfert.</p></div></div>
      <div className="detail-grid">{contacts.map(c=><div className="detail-item" key={c.channel}><label>{c.label}</label><strong>{c.number} · {c.holder}</strong>
        <button className="btn btn-sm btn-ghost" style={{marginTop:6}} onClick={()=>void navigator.clipboard?.writeText(c.number)}><Copy size={12}/>Copier le numéro</button></div>)}</div>
    </section>}

    <section className="card card-pad">
      <div className="section-head"><div><h2>{isSuper?'Commandes et encaissements':'Mes commandes'}</h2><p>Aucun crédit n’est ajouté sans vérification manuelle du transfert reçu.</p></div></div>
      <div className="toolbar">
        <div className="search-wrap"><Search size={14}/><input className="search-input" placeholder="Commande, client, référence…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="filter-pills">{filters.map(([k,n,c])=><button key={k} className={'filter-pill '+(filter===k?'active':'')} onClick={()=>setFilter(k)}>{n} · {c}</button>)}</div>
      </div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th>{isSuper&&<th>Client</th>}<th>Offre</th><th>Montant</th><th>Paiement</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map(o=>{const st=statusMeta[o.status]||{label:o.status,tone:'neutral'};return <tr key={o.id}>
          <td><div className="table-primary">{fmtDateTime(o.createdAt)}</div><div className="table-secondary">{o.invoiceNumber||o.id.slice(0,16)}</div></td>
          {isSuper&&<td><div className="table-primary">{o.customerName||'—'}</div></td>}
          <td><div className="table-primary">{o.planName}</div><div className="table-secondary">{o.quotaGb} Go</div></td>
          <td className="table-primary">{money(o.amount)}</td>
          <td><div>{channelLabel(o.channel)}</div><div className="table-secondary">{o.verifiedReference||o.claimedReference||'—'}</div></td>
          <td><span className={'badge badge-'+st.tone}>{st.label}</span>{o.rejectionReason&&<div className="table-secondary">{o.rejectionReason}</div>}</td>
          <td><div className="row-actions">
            {o.own&&(o.status==='pending'||o.status==='rejected')&&<button className="btn btn-sm btn-primary" onClick={()=>{setDeclare(o);setDeclareRef('');setDeclareChannel((o.channel as 'MOMO'|'OM')||'MOMO')}}>Déclarer le paiement</button>}
            {isSuper&&o.status==='submitted'&&<button className="btn btn-sm btn-primary" onClick={()=>openReview(o)}><BadgeCheck size={13}/>Vérifier</button>}
            {o.status==='paid'&&<button className="btn btn-sm" onClick={()=>void printInvoice(o)}><Printer size={13}/>Facture</button>}
          </div></td>
        </tr>})}</tbody></table></div>
      {!filtered.length&&<div className="empty-state"><ReceiptText size={24}/><strong>Aucune commande pour ce filtre</strong></div>}
    </section>

    {declare&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDeclare(null)}}><form className="modal" onSubmit={e=>void submitDeclaration(e)}>
      <div className="modal-head"><div><strong>Déclarer le paiement</strong><div className="card-subtitle">{declare.planName} · {money(declare.amount)} · {declare.quotaGb} Go</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setDeclare(null)}><X size={16}/></button></div>
      <div className="modal-body stack">
        <div className="detail-grid">{contacts.map(c=><div className="detail-item" key={c.channel}><label>{c.label}</label><strong>{c.number} · {c.holder}</strong></div>)}</div>
        <p className="card-subtitle">Envoyez exactement <strong>{money(declare.amount)}</strong>, puis saisissez la référence reçue par SMS.</p>
        <div className="form-grid">
          <label className="field-block"><span className="field-label">Moyen de paiement</span><select className="select" value={declareChannel} onChange={e=>setDeclareChannel(e.target.value as 'MOMO'|'OM')}><option value="MOMO">MTN MoMo</option><option value="OM">Orange Money</option></select></label>
          <label className="field-block"><span className="field-label">Référence de la transaction</span><input className="field" required minLength={3} maxLength={100} value={declareRef} onChange={e=>setDeclareRef(e.target.value)} placeholder="Ex. MP240101.1234.A56789"/></label>
        </div>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setDeclare(null)}>Plus tard</button><button className="btn btn-primary" disabled={working}>Envoyer la déclaration</button></div>
    </form></div>}

    {review&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setReview(null)}}><form className="modal" onSubmit={e=>void confirm(e)}>
      <div className="modal-head"><div><strong>Vérifier le paiement</strong><div className="card-subtitle">{review.customerName} · {review.planName} · {money(review.amount)}</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setReview(null)}><X size={16}/></button></div>
      <div className="modal-body stack">
        {!data?.canConfirm&&<p className="notice">La confirmation nécessite le stockage PostgreSQL transactionnel.</p>}
        <div className="detail-grid">
          <div className="detail-item"><label>Déclaré via</label><strong>{channelLabel(review.channel)}</strong></div>
          <div className="detail-item"><label>Référence déclarée</label><strong>{review.claimedReference||'—'}</strong></div>
        </div>
        <div className="form-grid">
          <label className="field-block"><span className="field-label">Canal réellement crédité</span><select className="select" value={reviewChannel} onChange={e=>setReviewChannel(e.target.value as 'MOMO'|'OM')}><option value="MOMO">MTN MoMo</option><option value="OM">Orange Money</option></select></label>
          <label className="field-block"><span className="field-label">Référence vérifiée</span><input className="field" required value={reviewRef} onChange={e=>setReviewRef(e.target.value)}/></label>
          <label className="field-block"><span className="field-label">Montant reçu (XAF)</span><input className="field" type="number" min={1} step={1} required value={reviewAmount} onChange={e=>setReviewAmount(Number(e.target.value))}/></label>
        </div>
        <label className="check-line"><input type="checkbox" checked={reviewChecked} onChange={e=>setReviewChecked(e.target.checked)}/>J’ai vérifié la réception effective de ce transfert sur le compte bénéficiaire.</label>
        <div className="soft-surface" style={{padding:12}}>
          <span className="field-label">Refuser la déclaration</span>
          <div className="row-actions"><input className="field" style={{flex:1,minWidth:180}} placeholder="Motif (3 caractères minimum)" maxLength={300} value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
            <button type="button" className="btn btn-danger btn-sm" disabled={working||rejectReason.trim().length<3} onClick={()=>void reject()}><Ban size={13}/>Refuser</button></div>
        </div>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setReview(null)}>Annuler</button><button className="btn btn-primary" disabled={working||!reviewChecked||!data?.canConfirm}><CheckCircle2 size={14}/>Confirmer et créditer {review.quotaGb} Go</button></div>
    </form></div>}

    {planForm&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPlanForm(null)}}><form className="modal" onSubmit={e=>void savePlan(e)}>
      <div className="modal-head"><div><strong>{planForm.id?'Modifier l’offre':'Nouvelle offre'}</strong><div className="card-subtitle">Pack de crédits vendu aux revendeurs.</div></div><button type="button" className="icon-button ghost" aria-label="Fermer" onClick={()=>setPlanForm(null)}><X size={16}/></button></div>
      <div className="modal-body form-grid">
        <label className="field-block"><span className="field-label">Nom de l’offre</span><input className="field" required maxLength={80} value={planForm.name||''} onChange={e=>setPlanForm({...planForm,name:e.target.value})}/></label>
        <label className="field-block"><span className="field-label">Prix (XAF)</span><input className="field" type="number" min={0} step={1} required value={planForm.priceCfa??0} onChange={e=>setPlanForm({...planForm,priceCfa:Number(e.target.value)})}/></label>
        <label className="field-block"><span className="field-label">Crédits (Go)</span><input className="field" type="number" min={0.01} step={0.01} required value={planForm.quotaGb??0} onChange={e=>setPlanForm({...planForm,quotaGb:Number(e.target.value)})}/></label>
        <label className="field-block"><span className="field-label">Durée de référence (jours)</span><input className="field" type="number" min={1} max={3650} step={1} required value={planForm.durationDays??30} onChange={e=>setPlanForm({...planForm,durationDays:Number(e.target.value)})}/></label>
        <label className="field-block"><span className="field-label">Badge (facultatif)</span><input className="field" maxLength={30} placeholder="Populaire" value={planForm.badge||''} onChange={e=>setPlanForm({...planForm,badge:e.target.value})}/></label>
        <label className="field-block"><span className="field-label">Description (facultatif)</span><input className="field" maxLength={200} value={planForm.description||''} onChange={e=>setPlanForm({...planForm,description:e.target.value})}/></label>
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={()=>setPlanForm(null)}>Annuler</button><button className="btn btn-primary" disabled={working}>Enregistrer l’offre</button></div>
    </form></div>}
  </div>;
}

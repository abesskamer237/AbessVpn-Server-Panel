import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {KeyRound,LockKeyhole,Monitor,ShieldCheck} from 'lucide-react';
import {fmtDateTime} from '../panelTypes';

type Session={id:string;current?:boolean;agent?:string;ip?:string;createdAt:string};
type Status={mfaEnabled:boolean;sessions?:Session[]};
type Props={
  request:(url:string,method?:string,body?:unknown)=>Promise<any>;
  onLogout:()=>void;
};

export function SecurityCenter({request,onLogout}:Props){
  const [status,setStatus]=useState<Status|null>(null);
  const [password,setPassword]=useState(''),[code,setCode]=useState(''),[newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const [setup,setSetup]=useState<{secret:string;uri:string}|null>(null),[qr,setQr]=useState('');
  const [recovery,setRecovery]=useState<string[]>([]);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);

  const call=(route:string,body?:unknown,method?:string)=>request('/api/v1/auth/'+route,method||(body?'POST':'GET'),body);
  async function refresh(){setStatus(await call('security'))}
  useEffect(()=>{void refresh().catch(e=>setMessage(e instanceof Error?e.message:'Chargement impossible'))},[]);
  async function run(work:()=>Promise<void>){
    setBusy(true);setMessage('');
    try{await work()}catch(e){setMessage(e instanceof Error?e.message:'Erreur réseau.')}finally{setBusy(false)}
  }
  const mismatch=newPassword.length>0&&confirmPassword.length>0&&newPassword!==confirmPassword;

  return <section className="stack" aria-labelledby="security-title">
    <h2 id="security-title" className="sr-only">Sécurité de votre compte</h2>
    {message&&<p role="status" className="notice">{message}</p>}
    <div className="metric-grid">
      <div className="card metric-card"><div className="metric-label"><KeyRound size={14}/>Double authentification</div><div className="metric-value" style={{fontSize:20}}>{status?status.mfaEnabled?'Activée':'Désactivée':'—'}</div><div className="metric-foot">Code TOTP à chaque connexion</div></div>
      <div className="card metric-card"><div className="metric-label"><Monitor size={14}/>Sessions actives</div><div className="metric-value">{status?.sessions?.length??'—'}</div><div className="metric-foot">Appareils connectés à ce compte</div></div>
    </div>
    <div className="grid-equal">
      <section className="card card-pad stack">
        <div className="section-head"><div><h2>Double authentification</h2><p>Application compatible TOTP (Google Authenticator, Aegis, 1Password…).</p></div><span className={'badge '+(status?.mfaEnabled?'badge-success':'badge-warning')}>{status?.mfaEnabled?'Activée':'À configurer'}</span></div>
        <label className="field-block"><span className="field-label">Mot de passe actuel</span><input className="field" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
        {(setup||status?.mfaEnabled)&&<label className="field-block"><span className="field-label">Code de sécurité ou de récupération</span><input className="field" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label>}
        {!status?.mfaEnabled&&!setup&&<button className="btn btn-primary" disabled={busy||!password} onClick={()=>void run(async()=>{
          const result=await call('mfa/setup',{password});setSetup(result);setQr(await QRCode.toDataURL(result.uri));
        })}><ShieldCheck size={14}/>Configurer la double authentification</button>}
        {setup&&<div className="stack">
          <img className="qr-image" src={qr} alt="QR code à scanner dans votre application d’authentification" width={180} height={180}/>
          <div><span className="field-label">Clé manuelle</span><div className="secret-value">{setup.secret}</div></div>
          <button className="btn btn-primary" disabled={busy||!code} onClick={()=>void run(async()=>{
            const result=await call('mfa/enable',{code});setRecovery(result.recoveryCodes);setSetup(null);setCode('');setPassword('');await refresh();
          })}>Confirmer l’activation</button>
        </div>}
        {status?.mfaEnabled&&<button className="btn btn-danger" disabled={busy||!password||!code} onClick={()=>void run(async()=>{await call('mfa/disable',{password,code});onLogout()})}>Désactiver et déconnecter les sessions</button>}
        {recovery.length>0&&<div className="notice notice-success">
          <strong>Codes de récupération — affichés une seule fois</strong>
          <p>Chaque code ne sert qu’une fois. Conservez-les dans un gestionnaire de mots de passe.</p>
          <pre className="secret-value" style={{whiteSpace:'pre-wrap'}}>{recovery.join('\n')}</pre>
          <div className="row-actions"><button className="btn btn-sm" onClick={()=>void navigator.clipboard?.writeText(recovery.join('\n'))}>Copier</button><button className="btn btn-sm" onClick={()=>setRecovery([])}>J’ai enregistré mes codes</button></div>
        </div>}
      </section>

      <section className="card card-pad stack">
        <div className="section-head"><div><h2>Changer le mot de passe</h2><p>16 caractères minimum. Toutes les sessions seront révoquées.</p></div><LockKeyhole size={18}/></div>
        <p className="card-subtitle">Le mot de passe actuel (champ de gauche) et, si activée, la double authentification sont requis.</p>
        <label className="field-block"><span className="field-label">Nouveau mot de passe</span><input className="field" type="password" minLength={16} maxLength={256} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
        <label className="field-block"><span className="field-label">Confirmer le nouveau mot de passe</span><input className="field" type="password" minLength={16} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/>{mismatch&&<span className="field-help" style={{color:'var(--danger)'}}>Les mots de passe ne correspondent pas.</span>}</label>
        <button className="btn btn-primary" disabled={busy||!password||newPassword.length<16||newPassword!==confirmPassword} onClick={()=>void run(async()=>{await call('password',{password,code,newPassword});onLogout()})}>Modifier et me reconnecter</button>
      </section>
    </div>

    <section className="card card-pad">
      <div className="section-head"><div><h2>Sessions actives</h2><p>Révoquez immédiatement un appareil inconnu.</p></div><Monitor size={18}/></div>
      <div className="alert-list">{status?.sessions?.map(session=><div className="alert-row session-row" key={session.id}>
        <span className="alert-dot" style={{background:session.current?'var(--brand)':'var(--info)'}}/>
        <div style={{flex:1,minWidth:0}}><p><strong>{session.current?'Cette session':session.agent||'Appareil'}</strong></p><span>{session.ip||'Adresse inconnue'} · ouverte le {fmtDateTime(session.createdAt)}</span></div>
        <button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>{await call('sessions/'+session.id,undefined,'DELETE');if(session.current)onLogout();else await refresh()})}>Révoquer</button>
      </div>)}</div>
    </section>
  </section>;
}

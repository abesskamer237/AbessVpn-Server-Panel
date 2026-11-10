import { ArrowUpRight, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';

interface Props {
  name: string;
  refreshing: boolean;
  updatedAt: Date | null;
  error: string | null;
  onRefresh: () => void;
  onOpenLicences: () => void;
}

export function WorkspaceWelcome({ name, refreshing, updatedAt, error, onRefresh, onOpenLicences }: Props) {
  return (
    <section className="workspace-welcome" aria-labelledby="workspace-title">
      <div className="welcome-copy">
        <span className="eyebrow"><ShieldCheck size={14} aria-hidden="true" /> VOTRE ESPACE ABESSVPN</span>
        <h2 id="workspace-title">Bonjour, {name.split(' ')[0] || name}<span>.</span></h2>
        <p>Votre réseau, une vue d’ensemble.<br className="hidden sm:block" /> Gérez vos accès et développez votre activité.</p>
        <button type="button" className="welcome-link" onClick={onOpenLicences}>
          Consulter les licences <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="welcome-status">
        <div className="status-symbol" aria-hidden="true"><ShieldCheck size={30} /></div>
        <div>
          <span className="status-caption">SYNCHRONISATION DU PANNEAU</span>
          <p role="status" aria-live="polite">
            {error ? 'Connexion à vérifier' : refreshing ? 'Actualisation en cours…' : updatedAt ? 'Données actualisées' : 'Chargement des données…'}
          </p>
          <span className="status-detail">
            {!error && updatedAt && <CheckCircle2 size={12} aria-hidden="true" />}
            {error || (updatedAt ? `À ${updatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Connexion à votre serveur')}
          </span>
        </div>
        <button type="button" className="sync-button" onClick={onRefresh} disabled={refreshing} aria-label="Actualiser les données">
          <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

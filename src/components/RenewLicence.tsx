import { useRef, useState } from "react";
export function RenewLicence({
  id,
  token,
  onClose,
  onSuccess,
}: {
  id: string;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [gb, setGb] = useState(10);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="renew-title"
        className="professional-section w-full max-w-md space-y-4"
      >
        <h2 id="renew-title">Renouveler la licence</h2>
        <p>
          Le quota consommé est conservé. Le quota ajouté est débité du solde du
          revendeur ; la durée prolonge l’expiration actuelle ou repart
          d’aujourd’hui si elle est dépassée.
        </p>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void fetch(`/api/v1/admin/tokens/${id}/renew`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Idempotency-Key": key.current,
              },
              body: JSON.stringify({ additionalGb: gb, days }),
            })
              .then(async (response) => {
                const body = await response.json();
                if (!response.ok)
                  throw new Error(body.error || "Renouvellement refusé.");
                onSuccess();
                onClose();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Quota supplémentaire (Go)
            <input
              autoFocus
              type="number"
              min={1}
              max={100000}
              required
              value={gb}
              onChange={(e) => setGb(Number(e.target.value))}
            />
          </label>
          <label>
            Prolongation (jours)
            <input
              type="number"
              min={1}
              max={365}
              required
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              className="secondary-action"
              disabled={busy}
              onClick={onClose}
            >
              Annuler
            </button>
            <button className="primary-action" disabled={busy}>
              Confirmer le renouvellement
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function MigrateTls({
  id,
  token,
  profiles,
  onClose,
  onSuccess,
}: {
  id: string;
  token: string;
  profiles: Array<{ id?: string; name?: string; transport: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const choices = profiles.filter(
    (p) => p.id && ["ws", "grpc", "httpupgrade", "xhttp"].includes(p.transport),
  );
  const [selected, setSelected] = useState(choices[0]?.id || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tls-title"
        className="professional-section w-full max-w-md space-y-4"
      >
        <h2 id="tls-title">Migrer vers un profil TLS</h2>
        <p>
          L’identité, le quota et l’expiration seront conservés. Le client devra
          réimporter sa licence pour appliquer le nouveau profil.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void fetch(`/api/v1/admin/tokens/${id}/migrate-tls`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ configurationId: selected }),
            })
              .then(async (response) => {
                const body = await response.json();
                if (!response.ok)
                  throw new Error(body.error || "Migration refusée.");
                onSuccess();
                onClose();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Profil TLS cible
            <select
              required
              className="bg-slate-900 border border-slate-700 rounded-xl p-3"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {choices.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.transport.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          {choices.length === 0 && (
            <p>Créez d’abord un profil TLS dans Infrastructure.</p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              className="secondary-action"
              disabled={busy}
              onClick={onClose}
            >
              Annuler
            </button>
            <button className="primary-action" disabled={busy || !selected}>
              Confirmer la migration
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

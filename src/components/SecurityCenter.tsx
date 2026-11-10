import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck, KeyRound, Monitor, LockKeyhole } from "lucide-react";
export function SecurityCenter({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [status, setStatus] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [setup, setSetup] = useState<any>(null);
  const [qr, setQr] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function call(route: string, body?: unknown, method?: string) {
    const response = await fetch("/api/v1/auth/" + route, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(payload.error || "Opération refusée.");
    return payload;
  }
  async function refresh() {
    setStatus(await call("security"));
  }
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [token]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="professional-section space-y-5"
      aria-labelledby="security-title"
    >
      <h2 id="security-title">
        <ShieldCheck /> Sécurité de votre compte
      </h2>
      <p>Protégez votre accès et contrôlez les appareils connectés.</p>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="settings-grid">
        <div className="settings-card space-y-4">
          <h3>
            <KeyRound /> Double authentification{" "}
            {status && (
              <span className="setting-badge">
                {status.mfaEnabled ? "Activée" : "À configurer"}
              </span>
            )}
          </h3>
          <p>
            Utilisez une application d’authentification compatible TOTP.
            Conservez les codes de récupération hors de ce panneau.
          </p>
          <label>
            Mot de passe actuel
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {(setup || status?.mfaEnabled) && (
            <label>
              Code de sécurité ou de récupération
              <input
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          {!status?.mfaEnabled && !setup && (
            <button
              className="primary-action"
              disabled={busy || !password}
              onClick={() =>
                void run(async () => {
                  const result = await call("mfa/setup", { password });
                  setSetup(result);
                  setQr(await QRCode.toDataURL(result.uri));
                })
              }
            >
              Configurer la double authentification
            </button>
          )}
          {setup && (
            <div className="space-y-3">
              <img
                src={qr}
                alt="QR code à scanner dans votre application d’authentification"
                width={180}
                height={180}
              />
              <code className="break-all block">{setup.secret}</code>
              <button
                className="primary-action"
                disabled={busy || !code}
                onClick={() =>
                  void run(async () => {
                    const result = await call("mfa/enable", { code });
                    setRecovery(result.recoveryCodes);
                    setSetup(null);
                    setCode("");
                    setPassword("");
                    await refresh();
                  })
                }
              >
                Confirmer l’activation
              </button>
            </div>
          )}
          {status?.mfaEnabled && (
            <button
              className="secondary-action"
              disabled={busy || !password || !code}
              onClick={() =>
                void run(async () => {
                  await call("mfa/disable", { password, code });
                  onLogout();
                })
              }
            >
              Désactiver et déconnecter les sessions
            </button>
          )}
          {recovery.length > 0 && (
            <div className="notice">
              <strong>Codes de récupération — affichés une seule fois</strong>
              <p>
                Chaque code ne peut servir qu’une fois. Copiez-les dans votre
                gestionnaire de mots de passe.
              </p>
              <pre className="whitespace-pre-wrap break-all">
                {recovery.join("\n")}
              </pre>
              <button
                className="secondary-action"
                onClick={() => setRecovery([])}
              >
                J’ai enregistré mes codes
              </button>
            </div>
          )}
        </div>
        <div className="settings-card space-y-4">
          <h3>
            <LockKeyhole /> Changer le mot de passe
          </h3>
          <p>
            Le mot de passe actuel et, si activée, la double authentification
            sont requis. Toutes les sessions seront révoquées.
          </p>
          <label>
            Nouveau mot de passe
            <input
              type="password"
              minLength={16}
              maxLength={256}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <button
            className="primary-action"
            disabled={busy || !password || newPassword.length < 16}
            onClick={() =>
              void run(async () => {
                await call("password", { password, code, newPassword });
                onLogout();
              })
            }
          >
            Modifier et me reconnecter
          </button>
          <h3>
            <Monitor /> Sessions actives
          </h3>
          {status?.sessions?.map((session: any) => (
            <div className="session-row" key={session.id}>
              <div>
                <strong>
                  {session.current
                    ? "Cette session"
                    : session.agent || "Appareil"}
                </strong>
                <p>
                  {session.ip || "Adresse inconnue"} ·{" "}
                  {new Date(session.createdAt).toLocaleString("fr-FR")}
                </p>
              </div>
              <button
                className="secondary-action"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await call("sessions/" + session.id, undefined, "DELETE");
                    if (session.current) onLogout();
                    else await refresh();
                  })
                }
              >
                Révoquer
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

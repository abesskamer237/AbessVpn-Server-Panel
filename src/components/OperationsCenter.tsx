import { useEffect, useState } from "react";
import { HeartPulse, Server, Download, Upload } from "lucide-react";
export function OperationsCenter({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [health, setHealth] = useState<any>(null);
  const [nodes, setNodes] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [nodeKey, setNodeKey] = useState<any>(null);
  const [message, setMessage] = useState("");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  async function call(route: string, body?: unknown, method?: string) {
    const response = await fetch("/api/v1/admin/" + route, {
      method: method || (body ? "POST" : "GET"),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok)
      throw new Error("Opération refusée ou service indisponible.");
    return response.status === 204 ? {} : response.json();
  }
  async function refresh() {
    const [status, list] = await Promise.all([
      call("operations"),
      call("nodes"),
    ]);
    setHealth(status);
    setNodes(list);
  }
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
    const timer = setInterval(
      () => void refresh().catch((e) => setMessage(e.message)),
      15000,
    );
    return () => clearInterval(timer);
  }, [token]);
  async function backup() {
    try {
      const value = await call("operations/backup");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "abess-backup.encrypted.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erreur réseau.");
    }
  }
  return (
    <section className="professional-section space-y-5">
      <h2>
        <HeartPulse /> Exploitation et infrastructure
      </h2>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="settings-grid">
        <div className="settings-card space-y-3">
          <h3>État du service</h3>
          {health ? (
            <>
              <p>
                Stockage : <strong>{health.storage}</strong>
              </p>
              <p>
                Xray : <strong>{health.xray ? "Prêt" : "Indisponible"}</strong>
              </p>
              <p>
                Disque disponible : {(health.freeBytes / 1024 ** 3).toFixed(1)}{" "}
                Go
              </p>
              <p>
                Sauvegarde :{" "}
                {health.backup
                  ? new Date(health.backup.at).toLocaleString("fr-FR")
                  : "À vérifier"}
              </p>
              <p>
                Copie hors serveur :{" "}
                {health.backup?.offsite ? "Confirmée" : "Non confirmée"}
              </p>
              {health.alerts.map((a: string) => (
                <p className="notice" key={a}>
                  {a}
                </p>
              ))}
            </>
          ) : (
            <p>Chargement…</p>
          )}
        </div>
        <div className="settings-card space-y-4">
          <h3>
            <Download /> Sauvegarde chiffrée
          </h3>
          <p>
            Conservez la sauvegarde et sa clé séparément. La restauration
            révoque les sessions ; elle remplace les données commerciales.
          </p>
          <button className="primary-action" onClick={() => void backup()}>
            Télécharger la sauvegarde
          </button>
          <label>
            <Upload size={16} /> Restaurer une sauvegarde chiffrée
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (
                  !file ||
                  !confirm(
                    "Remplacer les données par cette sauvegarde ? Un instantané préalable sera conservé.",
                  )
                )
                  return;
                void file
                  .text()
                  .then(JSON.parse)
                  .then((value) => call("operations/restore", value))
                  .then(onLogout)
                  .catch(() =>
                    setMessage(
                      "Restauration refusée : vérifiez le fichier et la clé.",
                    ),
                  );
              }}
            />
          </label>
        </div>
      </div>
      <div className="settings-card space-y-4">
        <h3>
          <Server /> Nœuds VPN
        </h3>
        <p>
          Associez ensuite l’hôte du nœud à un profil d’infrastructure. L’agent
          récupère uniquement les licences affectées à cet hôte.
        </p>
        <form
          className="node-form"
          onSubmit={(e) => {
            e.preventDefault();
            void call("nodes", { name, host })
              .then((value) => {
                setNodeKey(value);
                setName("");
                setHost("");
                return refresh();
              })
              .catch((e) => setMessage(e.message));
          }}
        >
          <label>
            Nom du nœud
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Hôte public
            <input
              required
              placeholder="vpn2.votre-domaine.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </label>
          <button className="primary-action">Enregistrer</button>
        </form>
        {nodeKey && (
          <div className="notice">
            <strong>Identifiants de l’agent — affichés une seule fois</strong>
            <p>ID : {nodeKey.id}</p>
            <code className="break-all block">{nodeKey.key}</code>
            <button
              className="secondary-action"
              onClick={() => setNodeKey(null)}
            >
              J’ai conservé la clé
            </button>
          </div>
        )}
        {nodes.map((node) => (
          <div key={node.id} className="session-row">
            <div>
              <strong>{node.name}</strong>
              <p>
                {node.host} ·{" "}
                {!node.enabled
                  ? "Révoqué"
                  : node.stale
                    ? "Agent hors ligne"
                    : node.ready
                      ? "Prêt"
                      : "Agent connecté, Xray non prêt"}
              </p>
            </div>
            {node.enabled && (
              <button
                className="secondary-action"
                onClick={() => {
                  if (confirm("Révoquer définitivement cet agent ?"))
                    void call("nodes/" + node.id, undefined, "DELETE")
                      .then(refresh)
                      .catch((e) => setMessage(e.message));
                }}
              >
                Révoquer
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

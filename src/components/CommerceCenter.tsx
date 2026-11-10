import { useEffect, useRef, useState } from "react";
import { CreditCard, Receipt, Copy, CheckCircle2 } from "lucide-react";
export function CommerceCenter({ token }: { token: string }) {
  const [data, setData] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const intent = useRef<Record<string, string>>({});
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  async function call(url: string, body?: unknown, extra = {}) {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { ...headers, ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Opération refusée.");
    return value;
  }
  async function refresh() {
    const [orders, offers] = await Promise.all([
      call("/api/v1/commerce/orders"),
      call("/api/v1/plans"),
    ]);
    setData(orders);
    setPlans(Array.isArray(offers) ? offers : offers.plans || []);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [token]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }
  async function requestOrder(plan: any) {
    const key =
      intent.current[plan.id] ||
      (intent.current[plan.id] = crypto.randomUUID());
    await call(
      "/api/v1/commerce/orders",
      { planId: plan.id },
      { "Idempotency-Key": key },
    );
  }
  async function invoice(id: string) {
    const view = window.open("", "_blank");
    if (view) view.opener = null;
    try {
      const value = await call(`/api/v1/commerce/orders/${id}/invoice`);
      if (!view)
        throw new Error(
          "Autorisez l’ouverture de la facture dans un nouvel onglet.",
        );
      view.document.title = "Facture " + value.number;
      const style = view.document.createElement("style");
      style.textContent =
        "body{font-family:system-ui,sans-serif;max-width:760px;margin:64px auto;padding:24px;color:#132c28}h1{font-size:32px}p{line-height:1.8}table{border-collapse:collapse;width:100%;margin:32px 0}td,th{text-align:left;border-bottom:1px solid #ccd9d3;padding:14px 8px}small{color:#52665e}button{padding:12px 18px;background:#047857;color:white;border:0;border-radius:8px}@media print{button{display:none}}";
      view.document.head.append(style);
      const add = (tag: string, text: string) => {
        const element = view.document.createElement(tag);
        element.textContent = text;
        view.document.body.append(element);
        return element;
      };
      add("h1", "Facture " + value.number);
      add(
        "p",
        `${value.seller.name} — ${value.seller.address} ${value.seller.taxId}`,
      );
      add(
        "p",
        `Client : ${value.customer.name || value.customer.id} · ${value.customer.email || ""}`,
      );
      add("p", `Date : ${new Date(value.date).toLocaleDateString("fr-FR")}`);
      const table = view.document.createElement("table");
      const head = view.document.createElement("tr");
      for (const text of ["Désignation", "Quantité", "Montant"]) {
        const th = view.document.createElement("th");
        th.textContent = text;
        head.append(th);
      }
      table.append(head);
      for (const item of value.items) {
        const row = view.document.createElement("tr");
        for (const text of [
          item.description + " · " + item.creditsGb + " Go",
          String(item.quantity),
          item.amount + " " + value.currency,
        ]) {
          const cell = view.document.createElement("td");
          cell.textContent = text;
          row.append(cell);
        }
        table.append(row);
      }
      view.document.body.append(table);
      add("h2", `Total payé : ${value.total} ${value.currency}`);
      add("p", `Référence de paiement : ${value.paymentReference}`);
      add("small", value.taxNotice);
      const button = add("button", "Imprimer / enregistrer en PDF");
      button.addEventListener("click", () => view.print());
    } catch (e) {
      view?.close();
      setError(e instanceof Error ? e.message : "Erreur réseau.");
    }
  }

  return (
    <section className="professional-section space-y-5">
      <h2>
        <CreditCard /> Paiements manuels et factures
      </h2>
      <p>
        Effectuez votre transfert vous-même, puis déclarez sa référence. Un
        administrateur vérifiera la réception avant d’ajouter les crédits. Aucun
        prélèvement ni paiement automatique n’est effectué.
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="settings-grid">
        {data?.contacts?.map((contact: any) => (
          <div key={contact.channel} className="settings-card space-y-3">
            <h3>{contact.label}</h3>
            <strong className="text-xl">{contact.number}</strong>
            <p>Bénéficiaire : {contact.holder}</p>
            <button
              className="secondary-action"
              onClick={() =>
                void navigator.clipboard
                  .writeText(contact.number)
                  .catch(() => setError("Copiez le numéro affiché."))
              }
            >
              <Copy size={14} /> Copier le numéro
            </button>
          </div>
        ))}
      </div>
      <p className="notice">
        Vérifiez le numéro et le nom du bénéficiaire dans votre application
        mobile money avant de confirmer le transfert. Une référence déclarée ne
        constitue pas une confirmation de paiement.
      </p>
      <div className="settings-grid">
        {plans
          .filter((plan) => plan.priceCfa > 0)
          .map((plan) => (
            <div className="settings-card space-y-3" key={plan.id}>
              <h3>{plan.name}</h3>
              <p>
                {plan.quotaGb} Go de crédits ·{" "}
                {plan.priceCfa.toLocaleString("fr-FR")} XAF
              </p>
              <button
                className="primary-action"
                disabled={busy}
                onClick={() => void run(() => requestOrder(plan))}
              >
                Demander cette recharge
              </button>
            </div>
          ))}
      </div>
      <div className="settings-card space-y-4">
        <h3>
          <Receipt /> Commandes et vérification manuelle
        </h3>
        {data?.orders?.length === 0 && <p>Aucune demande pour le moment.</p>}
        {data?.orders?.map((order: any) => (
          <div
            key={order.id}
            className="border-b border-slate-700/30 pb-5 space-y-3"
          >
            <div className="session-row">
              <div>
                <strong>
                  {order.planName} · {order.amount} XAF · {order.customerName}
                </strong>
                <p>
                  {{
                    pending: "À régler manuellement",
                    submitted: "Déclaration en attente de vérification",
                    paid: "Paiement confirmé manuellement",
                    rejected: "Déclaration refusée",
                    cancelled: "Annulée",
                  }[order.status as string] || order.status}{" "}
                  · {new Date(order.createdAt).toLocaleString("fr-FR")}
                </p>
                {order.claimedReference && (
                  <p>
                    Référence déclarée : {order.claimedReference} ·{" "}
                    {order.channel}
                  </p>
                )}
                {order.rejectionReason && (
                  <p>Motif : {order.rejectionReason}</p>
                )}
              </div>
              {order.status === "paid" && (
                <button
                  className="secondary-action"
                  onClick={() => void invoice(order.id)}
                >
                  Facture
                </button>
              )}
            </div>
            {order.own && ["pending", "rejected"].includes(order.status) && (
              <form
                className="node-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(() =>
                    call(`/api/v1/commerce/orders/${order.id}/submit`, {
                      channel: form.get("channel"),
                      reference: form.get("reference"),
                    }),
                  );
                }}
              >
                <label>
                  Canal utilisé
                  <select
                    className="bg-slate-900 border border-slate-700 rounded-xl p-3"
                    name="channel"
                    required
                  >
                    <option value="MOMO">MTN MoMo</option>
                    <option value="OM">Orange Money</option>
                  </select>
                </label>
                <label>
                  Référence de votre transfert
                  <input
                    name="reference"
                    required
                    minLength={3}
                    maxLength={100}
                  />
                </label>
                <button className="primary-action" disabled={busy}>
                  Soumettre pour vérification
                </button>
              </form>
            )}
            {data.canConfirm && order.status === "submitted" && (
              <div className="space-y-4">
                <form
                  className="node-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void run(() =>
                      call(`/api/v1/commerce/orders/${order.id}/confirm`, {
                        channel: form.get("channel"),
                        reference: form.get("reference"),
                        receivedAmount: Number(form.get("amount")),
                        confirmedReceived: form.get("verified") === "on",
                      }),
                    );
                  }}
                >
                  <label>
                    Canal vérifié
                    <select
                      className="bg-slate-900 border border-slate-700 rounded-xl p-3"
                      name="channel"
                      defaultValue={order.channel}
                      required
                    >
                      <option value="MOMO">MTN MoMo</option>
                      <option value="OM">Orange Money</option>
                    </select>
                  </label>
                  <label>
                    Référence reçue sur le compte
                    <input
                      name="reference"
                      defaultValue={order.claimedReference}
                      required
                      minLength={3}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Montant effectivement reçu (XAF)
                    <input
                      name="amount"
                      type="number"
                      min={1}
                      step={1}
                      required
                    />
                  </label>
                  <label className="!flex-row items-center">
                    <input
                      className="!w-auto"
                      type="checkbox"
                      name="verified"
                      required
                    />{" "}
                    J’ai vérifié la réception effective sur le compte
                    bénéficiaire.
                  </label>
                  <button className="primary-action" disabled={busy}>
                    <CheckCircle2 size={14} /> Confirmer et créditer
                  </button>
                </form>
                <form
                  className="node-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void run(() =>
                      call(`/api/v1/commerce/orders/${order.id}/reject`, {
                        reason: form.get("reason"),
                      }),
                    );
                  }}
                >
                  <label>
                    Motif si le transfert n’est pas confirmé
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={300}
                    />
                  </label>
                  <button className="secondary-action" disabled={busy}>
                    Refuser la déclaration
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

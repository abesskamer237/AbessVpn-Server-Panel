import crypto from "node:crypto";
import type { Express, RequestHandler } from "express";

export const MANUAL_PAYMENT_CONTACTS = [
  {
    channel: "MOMO",
    label: "MTN MoMo",
    number: "681328753",
    holder: "manga Ghislain",
  },
  {
    channel: "OM",
    label: "Orange Money",
    number: "695140419",
    holder: "mengue belinga",
  },
] as const;
type Channel = "MOMO" | "OM";
export interface Order {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  quotaGb: number;
  amount: number;
  currency: "XAF";
  status: "pending" | "submitted" | "paid" | "rejected" | "cancelled";
  createdAt: string;
  submittedAt?: string;
  paidAt?: string;
  channel?: Channel;
  claimedReference?: string;
  verifiedReference?: string;
  transactionId?: string;
  verifiedBy?: string;
  rejectionReason?: string;
  invoiceNumber?: string;
  idempotencyKey: string;
}
export interface CommerceState {
  orders: Order[];
}
function channelIsValid(value: unknown): value is Channel {
  return value === "MOMO" || value === "OM";
}
function referenceIsValid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9 ._/-]{2,99}$/.test(value.trim())
  );
}
const paymentKey = (channel: Channel, reference: string) =>
  channel + ":" + reference.replace(/[^a-z0-9]/gi, "").toUpperCase();

/** This function is called only after a Super Admin explicitly verifies the
 * transfer outside the application. A payer's declaration never credits money. */
export function confirmManualOrder(
  state: CommerceState,
  users: any[],
  order: Order,
  verified: { channel: unknown; reference: unknown; receivedAmount: unknown },
  adminId: string,
) {
  if (
    !channelIsValid(verified.channel) ||
    !referenceIsValid(verified.reference) ||
    !Number.isSafeInteger(verified.receivedAmount) ||
    verified.receivedAmount !== order.amount
  )
    throw new Error(
      "Vérifiez le canal, la référence réelle et le montant exact reçu.",
    );
  const key = paymentKey(verified.channel, verified.reference);
  if (order.status === "paid") {
    if (order.transactionId !== key)
      throw new Error(
        "Cette commande a déjà été confirmée avec une autre référence.",
      );
    return false;
  }
  if (order.status !== "submitted")
    throw new Error(
      "La déclaration de paiement doit être soumise avant validation.",
    );
  if (
    state.orders.some(
      (other) => other.id !== order.id && other.transactionId === key,
    )
  )
    throw new Error(
      "Cette transaction a déjà été utilisée pour une autre commande.",
    );
  const account = users.find(
    (user) => user.id === order.userId && user.status === "active",
  );
  if (
    !account ||
    !Number.isFinite(account.credits) ||
    account.credits + order.quotaGb > 1000000
  )
    throw new Error("Compte bénéficiaire indisponible ou plafond dépassé.");
  account.credits += order.quotaGb;
  order.status = "paid";
  order.channel = verified.channel;
  order.verifiedReference = verified.reference.trim();
  order.transactionId = key;
  order.verifiedBy = adminId;
  order.paidAt = new Date().toISOString();
  order.invoiceNumber = `ABESS-${new Date().getUTCFullYear()}-${order.id.slice(4).toUpperCase()}`;
  return true;
}
export function registerCommerce(
  app: Express,
  d: {
    authenticate: RequestHandler;
    limiter: RequestHandler;
    read: () => CommerceState;
    write: (state: CommerceState) => void;
    users: () => any[];
    saveUsers: (users: any[]) => void;
    plans: () => any[];
    audit: (event: any) => void;
    durable: () => boolean;
  },
) {
  const actor = (req: any) => req.user;
  app.get("/api/v1/payments/instructions", d.limiter, (_req, res) =>
    res.json({
      mode: "manual",
      currency: "XAF",
      contacts: MANUAL_PAYMENT_CONTACTS,
      notice:
        "Vérifiez le bénéficiaire avant le transfert. Aucun crédit ne sera ajouté sans vérification manuelle par un administrateur.",
    }),
  );
  app.get("/api/v1/commerce/orders", d.authenticate, (req, res) => {
    const users = d.users();
    res.json({
      mode: "manual",
      enabled: true,
      canConfirm: d.durable() && actor(req).role === "SUPER_ADMIN",
      contacts: MANUAL_PAYMENT_CONTACTS,
      orders: d
        .read()
        .orders.filter(
          (order) =>
            actor(req).role === "SUPER_ADMIN" || order.userId === actor(req).id,
        )
        .map((order) => ({
          ...order,
          own: order.userId === actor(req).id,
          customerName:
            users.find((user) => user.id === order.userId)?.name ||
            order.userId,
        })),
    });
  });
  app.post("/api/v1/commerce/orders", d.authenticate, (req, res) => {
    const key = String(req.headers["idempotency-key"] || "");
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key))
      return res
        .status(400)
        .json({ error: "Clé Idempotency-Key requise (16 à 100 caractères)." });
    const state = d.read();
    let order = state.orders.find(
      (order) => order.userId === actor(req).id && order.idempotencyKey === key,
    );
    if (order && order.planId !== req.body?.planId)
      return res
        .status(409)
        .json({ error: "Cette clé appartient à une autre commande." });
    if (!order) {
      const plan = d.plans().find((plan) => plan.id === req.body?.planId);
      if (
        !plan ||
        !Number.isSafeInteger(plan.priceCfa) ||
        plan.priceCfa <= 0 ||
        !Number.isFinite(plan.quotaGb) ||
        plan.quotaGb <= 0
      )
        return res.status(400).json({ error: "Offre payante invalide." });
      order = {
        id: "ord_" + crypto.randomBytes(16).toString("hex"),
        userId: actor(req).id,
        planId: plan.id,
        planName: plan.name,
        quotaGb: plan.quotaGb,
        amount: plan.priceCfa,
        currency: "XAF",
        status: "pending",
        createdAt: new Date().toISOString(),
        idempotencyKey: key,
      };
      state.orders.push(order);
      d.write(state);
    }
    res.status(201).json(order);
  });
  app.post("/api/v1/commerce/orders/:id/submit", d.authenticate, (req, res) => {
    const state = d.read();
    const order = state.orders.find(
      (order) => order.id === req.params.id && order.userId === actor(req).id,
    );
    if (!order) return res.sendStatus(404);
    if (order.status === "paid" || order.status === "cancelled")
      return res.status(409).json({ error: "Commande déjà traitée." });
    if (
      !channelIsValid(req.body?.channel) ||
      !referenceIsValid(req.body?.reference)
    )
      return res
        .status(400)
        .json({ error: "Canal et référence de transaction valides requis." });
    order.channel = req.body.channel;
    order.claimedReference = req.body.reference.trim();
    order.status = "submitted";
    order.submittedAt = new Date().toISOString();
    delete order.rejectionReason;
    d.write(state);
    d.audit({
      actor: actor(req).id,
      role: actor(req).role,
      action: "PAYMENT_DECLARED",
      details: `Commande ${order.id} : déclaration à vérifier, aucun crédit ajouté.`,
    });
    res.json(order);
  });
  app.post(
    "/api/v1/commerce/orders/:id/confirm",
    d.authenticate,
    (req, res) => {
      if (actor(req).role !== "SUPER_ADMIN") return res.sendStatus(403);
      if (!d.durable())
        return res
          .status(503)
          .json({
            error:
              "PostgreSQL est requis pour confirmer les crédits transactionnellement.",
          });
      if (req.body?.confirmedReceived !== true)
        return res
          .status(400)
          .json({
            error:
              "Confirmez avoir vérifié la réception effective du transfert.",
          });
      const state = d.read();
      const order = state.orders.find((order) => order.id === req.params.id);
      if (!order) return res.sendStatus(404);
      try {
        const users = d.users();
        if (
          confirmManualOrder(
            state,
            users,
            order,
            {
              channel: req.body?.channel,
              reference: req.body?.reference,
              receivedAmount: req.body?.receivedAmount,
            },
            actor(req).id,
          )
        ) {
          d.saveUsers(users);
          d.write(state);
          d.audit({
            actor: actor(req).id,
            role: actor(req).role,
            action: "MANUAL_PAYMENT_CONFIRMED",
            details: `Commande ${order.id} : ${order.amount} XAF reçus, ${order.quotaGb} Go ajoutés après vérification manuelle.`,
          });
        }
        res.json(order);
      } catch (error) {
        res
          .status(409)
          .json({
            error:
              error instanceof Error ? error.message : "Validation refusée.",
          });
      }
    },
  );
  app.post("/api/v1/commerce/orders/:id/reject", d.authenticate, (req, res) => {
    if (actor(req).role !== "SUPER_ADMIN") return res.sendStatus(403);
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 300)
      return res
        .status(400)
        .json({ error: "Motif de refus requis (3 à 300 caractères)." });
    const state = d.read();
    const order = state.orders.find((order) => order.id === req.params.id);
    if (!order) return res.sendStatus(404);
    if (order.status !== "submitted")
      return res
        .status(409)
        .json({ error: "Cette déclaration ne peut plus être refusée." });
    order.status = "rejected";
    order.rejectionReason = reason;
    d.write(state);
    d.audit({
      actor: actor(req).id,
      role: actor(req).role,
      action: "MANUAL_PAYMENT_REJECTED",
      details: order.id,
    });
    res.json(order);
  });
  app.get("/api/v1/commerce/orders/:id/invoice", d.authenticate, (req, res) => {
    const order = d
      .read()
      .orders.find(
        (order) =>
          order.id === req.params.id &&
          (order.userId === actor(req).id || actor(req).role === "SUPER_ADMIN"),
      );
    if (!order) return res.sendStatus(404);
    if (order.status !== "paid")
      return res
        .status(409)
        .json({
          error: "Facture disponible après confirmation manuelle du paiement.",
        });
    const customer = d.users().find((user) => user.id === order.userId);
    res
      .set("Cache-Control", "no-store")
      .set(
        "Content-Disposition",
        `attachment; filename="${order.invoiceNumber}.json"`,
      )
      .json({
        number: order.invoiceNumber,
        date: order.paidAt,
        seller: {
          name: process.env.INVOICE_SELLER_NAME || "ABESS VPN",
          address: process.env.INVOICE_SELLER_ADDRESS || "",
          taxId: process.env.INVOICE_SELLER_TAX_ID || "",
        },
        customer: {
          id: order.userId,
          name: customer?.name,
          email: customer?.email,
        },
        items: [
          {
            description: order.planName,
            quantity: 1,
            creditsGb: order.quotaGb,
            amount: order.amount,
          },
        ],
        currency: order.currency,
        total: order.amount,
        paymentReference: order.verifiedReference,
        paymentChannel: order.channel,
        confirmation: "Vérification manuelle par un administrateur",
        taxNotice:
          "Mentions fiscales à compléter selon le statut légal du vendeur.",
      });
  });
}

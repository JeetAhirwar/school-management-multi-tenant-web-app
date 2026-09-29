// Stripe driver for a school-owned Stripe account.
const { httpJson, notImplemented, constantTimeEqual, sha256Hex, parseJsonBody } = require("./base");

const MODE = "stripe";
const API = "https://api.stripe.com";

const getCheckoutConfig = (config) => ({
  mode: MODE,
  provider: MODE,
  publishableKey: config?.publishableKey || null,
  testMode: Boolean(config?.testMode),
});

// Validate the school's Stripe secret key with a read-only balance call.
const test = async (config) => {
  const { secretKey } = config || {};
  if (!secretKey) {
    return { ok: false, message: "Stripe secret key is required." };
  }
  const res = await httpJson(`${API}/v1/balance`, { headers: { Authorization: `Bearer ${secretKey}` } });
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.status === 401
          ? "Stripe rejected these credentials (unauthorized)."
          : `Stripe rejected the credentials (HTTP ${res.status}).`,
    };
  }
  return {
    ok: true,
    message: config.testMode ? "Stripe test key validated." : "Stripe live key validated.",
  };
};

// Create a PaymentIntent for the checkout. Amount is in the currency's minor
// unit (Stripe is non-INR native; the school picks the currency).
const createOrder = async (config, { amount, currency = "usd", receipt } = {}) => {
  const { secretKey } = config || {};
  if (!secretKey) {
    return { ok: false, message: "Stripe secret key is not configured for this school" };
  }
  const res = await httpJson(`${API}/v1/payment_intents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      amount: String(Math.round(Number(amount) * 100)),
      currency: String(currency).toLowerCase(),
      receipt_email: "",
      ...(receipt ? { statement_descriptor: String(receipt).slice(0, 22) } : {}),
    }).toString(),
  });
  if (!res.ok || !res.json?.id) {
    return {
      ok: false,
      message: `Stripe payment intent creation failed (HTTP ${res.status || "?"}): ${res.json?.error?.message || "unknown error"}`,
    };
  }
  return {
    ok: true,
    providerOrderId: res.json.id,
    extra: { clientSecret: res.json.client_secret },
  };
};

// Stripe webhooks: `stripe-signature: t=<ts>,v1=<expected>` HMAC over
// `t.<rawBody>` keyed by the WEBHOOK SECRET.
const verifyWebhook = async (config, { rawBody, headers } = {}) => {
  const secret = config?.webhookSecret;
  const header = headers?.["stripe-signature"];
  if (!secret || !header || rawBody == null) {
    return { verified: false };
  }
  const parts = {};
  String(header)
    .split(",")
    .forEach((p) => {
      const [k, ...rest] = p.split("=");
      parts[k.trim()] = rest.join("=");
    });
  const expected = sha256Hex(`${parts.t}.${typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody)}`, secret);
  if (!constantTimeEqual(expected, parts.v1 || "")) {
    return { verified: false };
  }
  const event = parseJsonBody(rawBody);
  const obj = event?.data?.object || {};
  return {
    verified: true,
    eventType: event?.type || null,
    orderId: obj.payment_intent || obj.id || null,
    paymentId: obj.id || event?.id || null,
    amount: obj.amount != null ? Number(obj.amount) / 100 : null,
    currency: obj.currency || null,
    captured: event?.type === "payment_intent.succeeded",
  };
};

module.exports = {
  mode: MODE,
  supportsOnline: true,
  getCheckoutConfig,
  test,
  createOrder,
  verifyPaymentSignature: async () => false, // Stripe modal uses the webhook only
  verifyWebhook,
  refund: notImplemented(MODE, "refunds"),
};
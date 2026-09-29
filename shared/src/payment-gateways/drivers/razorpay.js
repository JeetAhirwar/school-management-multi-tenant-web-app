// Razorpay driver for a school-owned merchant account. The school brings its
// own key ID + secret; money settles to the school's Razorpay account.
const { httpJson, basicAuth, notImplemented, constantTimeEqual, sha256Hex, parseJsonBody } = require("./base");

const MODE = "razorpay";
const API = "https://api.razorpay.com";

// Checkout only needs the (public) key ID — never the secret.
const getCheckoutConfig = (config) => ({
  mode: MODE,
  provider: MODE,
  keyId: config?.keyId || null,
  testMode: Boolean(config?.testMode),
});

// Validate the school's Razorpay keys with a read-only orders list call.
const test = async (config) => {
  const { keyId, keySecret } = config || {};
  if (!keyId || !keySecret) {
    return { ok: false, message: "Razorpay key ID and key secret are required." };
  }
  const res = await httpJson(`${API}/v1/orders?count=1`, {
    headers: { Authorization: basicAuth(keyId, keySecret) },
  });
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.status === 401
          ? "Razorpay rejected these credentials (unauthorized)."
          : `Razorpay rejected the credentials (HTTP ${res.status}).`,
    };
  }
  return {
    ok: true,
    message: config.testMode ? "Razorpay test keys validated." : "Razorpay live keys validated.",
  };
};

// Create a real Razorpay order. Amout is in INR (paise).
const createOrder = async (config, { amount, currency = "INR", receipt } = {}) => {
  const { keyId, keySecret } = config || {};
  if (!keyId || !keySecret) {
    return { ok: false, message: "Razorpay keys are not configured for this school" };
  }
  const res = await httpJson(`${API}/v1/orders`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(keyId, keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(Number(amount) * 100),
      currency,
      receipt: String(receipt || "").slice(0, 45) || undefined,
    }),
  });
  if (!res.ok || !res.json?.id) {
    return {
      ok: false,
      message: `Razorpay order creation failed (HTTP ${res.status || "?"}): ${res.json?.error?.description || "unknown error"}`,
    };
  }
  return { ok: true, providerOrderId: res.json.id, extra: { order: res.json } };
};

// Client-side payment signature (Razorpay checkout.js success payload).
// HMAC-SHA256 of `order_id|payment_id` keyed by the KEY SECRET.
const verifyPaymentSignature = async (config, payload = {}) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = payload;
  const secret = config?.keySecret;
  if (!secret || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) return false;
  const expected = sha256Hex(`${razorpayOrderId}|${razorpayPaymentId}`, secret);
  return constantTimeEqual(expected, razorpaySignature);
};

// Provider webhook (event subscription). Signature is HMAC-SHA256 of the raw
// body keyed by the WEBHOOK SECRET (x-razorpay-signature).
const verifyWebhook = async (config, { rawBody, headers } = {}) => {
  const secret = config?.webhookSecret;
  const presented = headers?.["x-razorpay-signature"];
  if (!secret || !presented || rawBody == null) {
    return { verified: false };
  }
  const expected = sha256Hex(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody), secret);
  if (!constantTimeEqual(expected, presented)) {
    return { verified: false };
  }
  const event = parseJsonBody(rawBody);
  const entity = event?.payload?.payment?.entity;
  return {
    verified: true,
    eventType: event?.event || null,
    orderId: entity?.order_id || event?.payload?.order?.entity?.id || null,
    paymentId: entity?.id || null,
    amount: entity?.amount != null ? Number(entity.amount) / 100 : null,
    currency: entity?.currency || null,
    captured: Boolean(entity && ["captured", "authorized"].includes(entity.status)),
  };
};

module.exports = {
  mode: MODE,
  supportsOnline: true,
  getCheckoutConfig,
  test,
  createOrder,
  verifyPaymentSignature,
  verifyWebhook,
  refund: notImplemented(MODE, "refunds"),
};
// PhonePe driver for a school-owned PhonePe PG merchant account.
//
// PhonePe authenticates every request with a salted checksum (X-VERIFY). Orders
// use the /v3/charge intent (UPI redirect); callbacks arrive as base64 JSON in
// the `response` field and are re-verified with the salt key.
const {
  httpJson,
  notImplemented,
  constantTimeEqual,
  sha256PlainHex,
  parseJsonBody,
  mask,
} = require("./base");

const MODE = "phonepe";
const VALID_ENVS = ["prod", "uat"];

const PRODUCTION_BASE = "https://api.phonepe.com/apis/hermes";
const UAT_BASE = "https://api.phonepe.com/apis/hermes-stg";

const baseFor = (env) => (env === "uat" ? UAT_BASE : PRODUCTION_BASE);

const getCheckoutConfig = (config) => ({
  mode: MODE,
  provider: MODE,
  merchantId: config?.merchantId || null,
  env: config?.env || "prod",
  baseUrl: baseFor(config?.env),
});

const test = async (config) => {
  const { merchantId, saltKey, saltIndex, env } = config || {};
  if (!merchantId || !saltKey || !saltIndex) {
    return { ok: false, message: "PhonePe merchant ID, salt key and salt index are required." };
  }
  if (env && !VALID_ENVS.includes(env)) {
    return { ok: false, message: `PhonePe env must be one of: ${VALID_ENVS.join(", ")}.` };
  }
  return {
    ok: true,
    message: "PhonePe credentials are valid in shape (live connectivity needs a real charge).",
  };
};

// Create a UPI charge intent. Returns a redirect URL the payer opens.
const createOrder = async (config, { amount, currency: _currency = "INR", receipt } = {}) => {
  const { merchantId, saltKey, saltIndex, env } = config || {};
  if (!merchantId || !saltKey || !saltIndex) {
    return { ok: false, message: "PhonePe merchant credentials are not configured for this school" };
  }
  const merchantTransactionId = `STX_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = {
    merchantId,
    merchantTransactionId,
    merchantUserId: `MUID_${merchantId}`,
    amount: Math.round(Number(amount) * 100),
    merchantOrderId: String(receipt || "").slice(0, 40) || String(merchantTransactionId),
    paymentInstrument: { type: "UPI_INTENT" },
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const xVerify = `${sha256PlainHex(`${b64}${saltKey}${saltIndex}`)}###${saltIndex}`;

  const res = await httpJson(`${baseFor(env)}/pg/v3/charge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": xVerify,
      "X-MERCHANT-ID": merchantId,
    },
    body: JSON.stringify({ request: b64 }),
  });
  const data = res.json?.data || {};
  const instrument = data.instrumentResponse || {};
  if (!res.ok || !instrument.redirectInfo?.url) {
    return {
      ok: false,
      message: `PhonePe charge initiation failed (HTTP ${res.status || "?"}): ${res.json?.message || "unknown error"}`,
    };
  }
  return {
    ok: true,
    providerOrderId: data.merchantTransactionId || merchantTransactionId,
    extra: { payUrl: instrument.redirectInfo.url, request: b64 },
  };
};

// Callback webhook: `X-VERIFY` over the raw (`response` is base64 JSON). The
// documented checksum is sha256(base64(payload)//full body + saltKey + saltIndex).
const verifyWebhook = async (config, { rawBody, headers } = {}) => {
  const saltKey = config?.saltKey;
  const saltIndex = config?.saltIndex;
  const presented = headers?.["x-verify"];
  const raw = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody || "");
  if (!saltKey || !saltIndex || !presented || !raw) {
    return { verified: false };
  }
  const expected = sha256PlainHex(`${raw}${saltKey}${saltIndex}`);
  if (!constantTimeEqual(expected, presented)) {
    return { verified: false };
  }
  const root = parseJsonBody(rawBody);
  const parsed = root?.response ? parseJsonBody(Buffer.from(root.response, "base64").toString("utf8")) : root;
  const data = parsed?.data || {};
  const instrument = data.paymentInstrument || {};
  return {
    verified: true,
    eventType: parsed?.code || null,
    orderId: data.merchantTransactionId || null,
    paymentId: data.transactionId || null,
    amount: data.amount != null ? Number(data.amount) / 100 : null,
    currency: "INR",
    captured: parsed?.code === "PAYMENT_SUCCESS",
    instrument,
  };
};

module.exports = {
  mode: MODE,
  supportsOnline: true,
  getCheckoutConfig,
  test,
  createOrder,
  verifyPaymentSignature: async () => false, // PhonePe confirms via its redirect + callback only
  verifyWebhook,
  refund: notImplemented(MODE, "refunds"),
  maskSaltKey: (k) => mask(k),
};
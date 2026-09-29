// Platform-hosted gateway. The school does not bring its own keys — the
// platform's own provider credentials (PAYMENT_PROVIDER_*) drive checkout.
const razorpayDriver = require("./razorpay");
const stripeDriver = require("./stripe");
const { mask, credentialField } = require("./base");

const MODE = "platform";

const isEnabled = () =>
  process.env.PAYMENT_PROVIDER_ENABLED === "true" &&
  Boolean(process.env.PAYMENT_PROVIDER_NAME);

const providerName = () => process.env.PAYMENT_PROVIDER_NAME || "unconfigured";

const isRazorpay = () => String(providerName()).toLowerCase() === "razorpay";
const isStripe = () => String(providerName()).toLowerCase() === "stripe";

const envConfig = () => ({
  keyId: process.env.PAYMENT_PROVIDER_KEY_ID || null,
  keySecret: process.env.PAYMENT_PROVIDER_KEY_SECRET || null,
  webhookSecret: process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET || null,
  publishableKey: process.env.PAYMENT_PROVIDER_PUBLISHABLE_KEY || null,
  secretKey: process.env.PAYMENT_PROVIDER_KEY_SECRET || null,
  checkoutBase: process.env.PAYMENT_PROVIDER_CHECKOUT_BASE || null,
});

// Mirrors fee-service's honest 503: with no provider configured the platform
// gateway reports itself as not ready rather than pretending checkout works.
const getCheckoutConfig = () => {
  const base = {
    mode: MODE,
    provider: providerName(),
    enabled: isEnabled(),
    checkoutBase: envConfig().checkoutBase,
  };
  if (isRazorpay()) return { ...base, keyId: envConfig().keyId };
  if (isStripe()) return { ...base, publishableKey: envConfig().publishableKey };
  return base;
};

// Validate the platform credentials with a cheap read-only call per provider.
const test = async () => {
  const name = String(providerName()).toLowerCase();
  if (!process.env.PAYMENT_PROVIDER_KEY_ID || !process.env.PAYMENT_PROVIDER_KEY_SECRET) {
    return { ok: false, message: "PAYMENT_PROVIDER_KEY_ID / KEY_SECRET are not set." };
  }
  const delegate = name === "stripe" ? stripeDriver : razorpayDriver;
  const cfg = envConfig();
  return delegate.test(cfg);
};

// Platform orders go through the provider driver with platform credentials.
const createOrder = async (_config, opts) => {
  const delegate = isStripe() ? stripeDriver : razorpayDriver;
  if (!isEnabled()) {
    return { ok: false, message: "The platform payment provider is not enabled", code: "PROVIDER_NOT_CONFIGURED" };
  }
  return delegate.createOrder(envConfig(), opts);
};

const verifyPaymentSignature = async (config, payload) => {
  const delegate = isStripe() ? stripeDriver : razorpayDriver;
  return delegate.verifyPaymentSignature(envConfig(), payload);
};

const verifyWebhook = async (config, opts) => {
  const delegate = isStripe() ? stripeDriver : razorpayDriver;
  return delegate.verifyWebhook(envConfig(), opts);
};

const getCredentialStatus = () => ({
  provider: providerName(),
  enabled: isEnabled(),
  keyId: credentialField(process.env.PAYMENT_PROVIDER_KEY_ID),
  secret: credentialField(process.env.PAYMENT_PROVIDER_KEY_SECRET),
  webhookSecret: credentialField(process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET),
  displayKeyId: process.env.PAYMENT_PROVIDER_KEY_ID
    ? mask(process.env.PAYMENT_PROVIDER_KEY_ID)
    : null,
});

module.exports = {
  mode: MODE,
  supportsOnline: true,
  isEnabled,
  providerName,
  getCheckoutConfig,
  getCredentialStatus,
  test,
  createOrder,
  verifyPaymentSignature,
  verifyWebhook,
};
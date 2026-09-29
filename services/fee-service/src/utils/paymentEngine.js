// Shared payment engine core (fee-service). Single place that RESOLVES a
// school gateways, builds provider orders and COMPLETES orders, run by all
// confirmation paths (signed webhook, client payment signature, and later the
// staff manual queue) with the same idempotent side effects.
const FeeInvoice = require("../models/FeeInvoice");
const Payment = require("../models/Payment");
const PaymentOrder = require("../models/PaymentOrder");
const { paymentGateways } = require("@school-erp/shared");
const gatewayClient = require("./gatewayClient");
const { applyPaymentToInvoice, createPaymentWithReceipt, voidPayment } = require("./paymentWrite");

const AUTH_URL = process.env.AUTH_SERVICE_URL || "http://localhost:5001";
const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;

const USABLE_STATUSES = ["active", "pending_verification"];
const ONLINE_MODES = ["platform", "razorpay", "stripe", "phonepe"];
const MANUAL_MODES = ["upi", "qr", "bank", "manual"];
// How an order's gateway mode is recorded on the fee ledger when the money is
// verified by the school office instead of a gateway webhook (CLIENT-REQ-037/
// 038: UPI orders land as UPI, bank transfers as Bank Transfer).
const MODE_ROUTING = { upi: "UPI", qr: "UPI", bank: "Bank Transfer" };

// The school's effective gateway; falls back to the platform mode when a
// config is missing or disabled (a school is never gateway-less).
const resolveGateway = async (schoolId) => {
  const cfg = await gatewayClient.getGatewayConfig(schoolId);
  if (cfg && USABLE_STATUSES.includes(cfg.status)) return cfg;
  return { schoolId, mode: "platform", status: "active", providers: {}, display: {} };
};

const driverFor = (mode) => {
  const { driver } = paymentGateways.driverFor({ mode: MANUAL_MODES.includes(mode) ? "manual" : mode });
  return driver;
};

// Driver config per mode: platform reads environment credentials, the school
// online modes read the decrypted provider block from auth.
const driverConfig = (gateway, mode) =>
  mode === "platform" ? {} : gateway.providers?.[mode] || {};

// Try to create a real provider order (online modes). Never throws — failures
// leave the order pending/unconfigured so the honest 503 surfaces at checkout.
// Driven by the ORDER's gateway mode (a payer may pick a school-enabled
// alternative such as UPI while the school default is an online gateway).
const tryCreateProviderOrder = async (order, gateway) => {
  if (!ONLINE_MODES.includes(order.gatewayMode)) return;
  try {
    const created = await driverFor(order.gatewayMode).createOrder(driverConfig(gateway, order.gatewayMode), {
      amount: order.amount,
      currency: order.currency || "INR",
      receipt: order.externalRef,
    });
    if (created.ok) {
      order.providerOrderId = created.providerOrderId;
      order.provider = order.gatewayMode;
    } else {
      order.provider = "unconfigured";
    }
  } catch {
    order.provider = "unconfigured";
  }
};

// Client-safe checkout descriptor for an order (never secrets).
const buildCheckout = (order, gateway) => {
  const isManual = MANUAL_MODES.includes(order.gatewayMode);
  // Manual display data lives on gateway.display (upiId, QR, bank details) —
  // not in providers[mode], which only exists for online gateways.
  const config = isManual
    ? { mode: order.gatewayMode, display: gateway.display || {} }
    : driverConfig(gateway, order.gatewayMode);
  const driver = driverFor(order.gatewayMode);
  const base = driver.getCheckoutConfig(config) || {};
  const upiId = base.display?.upiId || null;
  // First-class UPI (CLIENT-REQ-037): a standards-compliant UPI intent the FE
  // can open directly or render as a QR payload.
  const upiIntent =
    order.gatewayMode === "upi" && upiId
      ? `upi://pay?pa=${encodeURIComponent(upiId)}&am=${Number(order.amount)}&cu=${encodeURIComponent(order.currency || "INR")}&tn=${encodeURIComponent(order.externalRef || "")}`
      : null;
  return {
    mode: order.gatewayMode,
    provider: order.provider,
    amount: order.amount,
    currency: order.currency,
    providerOrderId: order.providerOrderId || null,
    checkoutUrl: base.checkoutUrl || base.payUrl || base.checkoutBase || null,
    keyId: base.keyId || null,
    publishableKey: base.publishableKey || null,
    merchantId: base.merchantId || null,
    baseUrl: base.baseUrl || null,
    enabled: Boolean(base.enabled !== undefined ? base.enabled : order.providerOrderId),
    display: base.display || null,
    upiId,
    upiIntent,
  };
};

// Idempotent completion. One caller wins the findOneAndUpdate; everything else
// sees { already: true }. Side effects run exactly once for the winner.
// On side-effect failure the order is rolled back out of `completed` so a
// webhook/confirm retry can re-run them — never leave a false-completed order.
const completeOrder = async (order, { confirmedBy, paymentExtras = {} } = {}) => {
  const winner = await PaymentOrder.findOneAndUpdate(
    { _id: order._id, status: { $in: ["pending", "awaiting_confirmation", "awaiting_manual_confirm"] } },
    {
      $set: {
        status: "completed",
        confirmedAt: new Date(),
        confirmedBy: confirmedBy || "gateway",
      },
    },
    { new: true }
  );
  if (!winner) return { already: true };

  try {
    if (winner.purpose === "subscription_upgrade") {
      await notifyAuthSubscriptionPaid(winner);
    } else {
      await reconcileFeePayment(winner, paymentExtras);
    }
    return { already: false, order: winner };
  } catch (err) {
    // Allow a later webhook/confirm to retry side effects for this order.
    await PaymentOrder.updateOne(
      { _id: winner._id, status: "completed" },
      {
        $set: {
          status: winner.status === "completed" ? "awaiting_confirmation" : winner.status,
          confirmedAt: null,
          confirmedBy: null,
        },
      }
    ).catch(() => {});
    throw err;
  }
};

// Fee invoice reconciliation (mirrors the legacy confirm-order accounting).
// Idempotent: skips if a Payment for this order already exists, and the invoice
// credit is an atomic conditional $inc (never a read-modify-write), so a
// concurrent manual collection on the same invoice cannot lose this update.
// allowOvercredit: gateway money already moved — the credit must land even if
// a manual payment raced the balance to zero (the overage shows in reports).
const reconcileFeePayment = async (order, extras = {}) => {
  const invoice = await FeeInvoice.findOne({ _id: order.invoiceId, schoolId: order.schoolId });
  if (!invoice) {
    console.error(`[fee-engine] invoice ${order.invoiceId} missing for completed order ${order._id}`);
    return;
  }
  const transactionId = order.providerOrderId || order.externalRef;
  const existing = await Payment.findOne({
    schoolId: order.schoolId,
    invoiceId: invoice._id,
    transactionId,
  }).lean();
  if (existing) return;

  const payment = await createPaymentWithReceipt({
    schoolId: order.schoolId,
    invoiceId: invoice._id,
    studentId: order.studentId,
    amount: order.amount,
    // Office-verified orders record their real ledger mode (UPI/Bank Transfer…);
    // gateway-confirmed online orders record Online Gateway.
    mode: extras.mode || MODE_ROUTING[order.gatewayMode] || "Online Gateway",
    transactionId,
    collectedBy: `${order.confirmedBy || "gateway"}:${order.gatewayMode || "platform"}`,
    ...(extras.receivedRef ? { receivedRef: String(extras.receivedRef).slice(0, 120) } : {}),
    ...(extras.chequeNo ? { chequeNo: String(extras.chequeNo).slice(0, 40), clearanceStatus: "Pending" } : {}),
    ...(extras.bankName ? { bankName: String(extras.bankName).slice(0, 120) } : {}),
    ...(extras.chequeDate ? { chequeDate: new Date(extras.chequeDate) } : {}),
  });
  const updated = await applyPaymentToInvoice(invoice._id, order.schoolId, Number(order.amount), {
    receiptNo: payment.receiptNo,
    allowOvercredit: true,
  });
  if (!updated) {
    await voidPayment(payment, `invoice ${invoice._id} rejected the order credit`);
    throw new Error(`Fee invoice ${invoice._id} could not be credited for order ${order._id}`);
  }
};

// Subscription upgrades are applied by auth-service (single billing source).
// Non-fatal: if this fails the order stays completed and the confirm/webhook
// retries are idempotent.
const notifyAuthSubscriptionPaid = async (order) => {
  if (!INTERNAL_KEY) {
    console.error("[fee-engine] INTERNAL_NOTIFY_KEY missing — cannot apply subscription switch");
    return;
  }
  try {
    await fetch(`${AUTH_URL}/api/auth/internal/subscription-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
      body: JSON.stringify({
        schoolId: order.schoolId,
        planId: order.metadata?.planId,
        amount: order.amount,
        currency: order.currency,
        orderId: String(order._id),
        providerOrderId: order.providerOrderId || null,
        durationPeriods: order.metadata?.durationPeriods || 1,
        switchMode: order.metadata?.switchMode || "immediate",
        startDate: order.metadata?.startDate || null,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error("[fee-engine] subscription-paid callback failed:", err.message);
  }
};

module.exports = {
  resolveGateway,
  driverFor,
  driverConfig,
  tryCreateProviderOrder,
  buildCheckout,
  completeOrder,
  ONLINE_MODES,
  MANUAL_MODES,
  MODE_ROUTING,
};
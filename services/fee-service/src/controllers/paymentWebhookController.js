// Provider webhook entry (Razorpay/Stripe/PhonePe -> /api/webhooks/:provider[/:schoolCode]).
// Raw body is preserved for signature verification. Orders are completed
// through the shared engine (idempotent), with side effects per purpose.
//
// Platform mode: POST /api/webhooks/razorpay  (no schoolCode needed)
// School-owned:  POST /api/webhooks/razorpay/:schoolCode
const PaymentOrder = require("../models/PaymentOrder");
const gatewayClient = require("../utils/gatewayClient");
const engine = require("../utils/paymentEngine");
const { paymentGateways } = require("@school-erp/shared");

const PROVIDERS = ["razorpay", "stripe", "phonepe"];

const handleWebhook = async (req, res) => {
  try {
    const { provider, schoolCode } = req.params;
    if (!PROVIDERS.includes(provider)) return res.status(404).json({ success: false, message: "Unknown provider" });

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body || "");
    const headers = req.headers;

    // --- Platform mode (no schoolCode): use platform driver directly --------
    if (!schoolCode) {
      if (String(process.env.PAYMENT_PROVIDER_NAME || "").toLowerCase() !== provider) {
        return res.json({ success: true, message: "provider-mismatch" });
      }

      const platformDriver = paymentGateways.driverFor({ mode: "platform" }).driver;
      const verified = await platformDriver.verifyWebhook({}, { rawBody, headers });
      if (!verified || !verified.verified) {
        return res.status(401).json({ success: false, message: "Bad webhook signature" });
      }
      if (!verified.captured || !verified.orderId) {
        return res.json({ success: true, message: "ignored-event" });
      }

      const order = await PaymentOrder.findOne({ providerOrderId: verified.orderId });
      if (!order) return res.json({ success: true, message: "order-not-found" });

      // Signed failure events (e.g. payment.failed) resolve the status instead
      // of leaving the order awaiting forever. paymentId guards against
      // non-payment events that merely carry an order id.
      if (verified.paymentId && !verified.captured) {
        await markOrderFailed(order, verified.eventType);
        return res.json({ success: true, message: "failure-recorded" });
      }

      if (verified.amount != null && Math.abs(Number(verified.amount) - Number(order.amount)) >= 1) {
        console.error(
          `[fee-admin] amount mismatch order ${order._id}: expected ${order.amount} received ${verified.amount}`
        );
        // Never record money that does not match the order (CLIENT-REQ-035).
        return res.status(400).json({ success: false, code: "AMOUNT_MISMATCH", message: "Webhook amount does not match the order" });
      }

      const result = await engine.completeOrder(order, {
        confirmedBy: `webhook:${provider}:${verified.paymentId || "?"}`,
      });
      return res.json({ success: true, data: { already: result.already } });
    }

    // --- School-owned gateway mode (schoolCode provided) --------------------
    const gateway = await gatewayClient.getGatewayConfigByCode(schoolCode);
    if (!gateway || !["active", "pending_verification"].includes(gateway.status)) {
      return res.json({ success: true, message: "no-gateway" });
    }

    const candidates = [];
    if (String(process.env.PAYMENT_PROVIDER_NAME || "").toLowerCase() === provider) {
      candidates.push({ driver: paymentGateways.driverFor({ mode: "platform" }).driver, config: {} });
    }
    if (gateway.mode === provider && gateway.providers?.[provider]) {
      candidates.push({ driver: engine.driverFor(provider), config: gateway.providers[provider] });
    }

    let verified = null;
    for (const c of candidates) {
      const result = await c.driver.verifyWebhook(c.config, { rawBody, headers });
      if (result.verified) {
        verified = result;
        break;
      }
    }
    if (!verified) {
      return res.status(401).json({ success: false, message: "Bad webhook signature" });
    }
    if (!verified.captured || !verified.orderId) {
      return res.json({ success: true, message: "ignored-event" });
    }

    const order = await PaymentOrder.findOne({ schoolId: gateway.schoolId, providerOrderId: verified.orderId });
    if (!order) return res.json({ success: true, message: "order-not-found" });

    // Signed failure events (e.g. payment.failed) resolve the status instead
    // of leaving the order awaiting forever. paymentId guards against
    // non-payment events that merely carry an order id.
    if (verified.paymentId && !verified.captured) {
      await markOrderFailed(order, verified.eventType);
      return res.json({ success: true, message: "failure-recorded" });
    }

    if (verified.amount != null && Math.abs(Number(verified.amount) - Number(order.amount)) >= 1) {
      console.error(
        `[fee-admin] amount mismatch order ${order._id}: expected ${order.amount} received ${verified.amount}`
      );
      // Never record money that does not match the order (CLIENT-REQ-035).
      return res.status(400).json({ success: false, code: "AMOUNT_MISMATCH", message: "Webhook amount does not match the order" });
    }

    const result = await engine.completeOrder(order, {
      confirmedBy: `webhook:${provider}:${verified.paymentId || "?"}`,
    });
    res.json({ success: true, data: { already: result.already } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Flip an unresolved order to `failed` on a signed provider failure event so
// the payer can retry or cancel — never on completed/cancelled orders.
const markOrderFailed = async (order, eventType) => {
  if (!["pending", "awaiting_confirmation"].includes(order.status)) return;
  order.status = "failed";
  order.metadata = { ...(order.metadata || {}), lastFailure: eventType || "provider-failure" };
  await order.save();
  console.error(`[fee-admin] order ${order._id} marked failed by webhook event ${eventType || "?"}`);
};

module.exports = { handleWebhook };
// Internal order creation (auth-service -> fee-service). Guards service calls
// with the shared internal key; NOT exposed via the public gateway.
const crypto = require("node:crypto");
const PaymentOrder = require("../models/PaymentOrder");
const engine = require("../utils/paymentEngine");
const { paymentGateways } = require("@school-erp/shared");

const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;
const keyUsable = () => Boolean(INTERNAL_KEY && String(INTERNAL_KEY).length >= 32);

const guard = (req, res, next) => {
  if (!keyUsable()) {
    return res.status(401).json({ success: false, message: "Internal key is not configured" });
  }
  const presented = req.headers["x-internal-key"];
  if (!presented) {
    return res.status(401).json({ success: false, message: "Missing internal key" });
  }
  const expectedHex = Buffer.from(String(INTERNAL_KEY), "utf8").toString("hex");
  const presentedHex = Buffer.from(String(presented), "utf8").toString("hex");
  const valid =
    expectedHex.length === presentedHex.length &&
    crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(presentedHex));
  if (!valid) {
    return res.status(401).json({ success: false, message: "Invalid internal key" });
  }
  next();
};

// Subscription upgrades are always paid on the PLATFORM gateway (the school is
// paying the platform). Amount comes from the trusted caller (auth-service).
const createSubscriptionOrder = async (req, res) => {
  try {
    const { schoolId, planId, amount, currency, durationPeriods, switchMode, startDate } = req.body || {};
    if (!schoolId || !planId) {
      return res.status(400).json({ success: false, message: "schoolId and planId are required" });
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "A valid positive amount is required" });
    }

    const gateway = { mode: "platform", status: "active" };
    const order = await PaymentOrder.create({
      schoolId,
      purpose: "subscription_upgrade",
      gatewayMode: "platform",
      provider: "platform",
      amount: Number(amount),
      currency: currency || "INR",
      externalRef: `SUB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      status: "pending",
      metadata: {
        planId,
        durationPeriods: Number(durationPeriods) || 1,
        switchMode: switchMode || "immediate",
        startDate: startDate || null,
      },
    });

    await engine.tryCreateProviderOrder(order, gateway);
    await order.save();

    const platformDriver = paymentGateways.driverFor({ mode: "platform" }).driver;
    const builtCheckout = platformDriver.getCheckoutConfig() || {};
    const checkout = {
      ...builtCheckout,
      amount: order.amount,
      currency: order.currency,
      providerOrderId: order.providerOrderId,
      enabled: Boolean(order.providerOrderId),
    };

    res.status(201).json({
      success: true,
      data: {
        id: order._id,
        purpose: order.purpose,
        gatewayMode: order.gatewayMode,
        amount: order.amount,
        currency: order.currency,
        provider: order.provider,
        providerOrderId: order.providerOrderId,
        status: order.status,
        checkout,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { guard, createSubscriptionOrder };
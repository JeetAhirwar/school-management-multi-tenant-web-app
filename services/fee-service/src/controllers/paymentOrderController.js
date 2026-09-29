const FeeInvoice = require("../models/FeeInvoice");
const PaymentOrder = require("../models/PaymentOrder");
const Payment = require("../models/Payment");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const engine = require("../utils/paymentEngine");

const GATEWAY_MODES = ["platform", "razorpay", "stripe", "phonepe", "upi", "qr", "bank", "manual"];

// Creates a payment order against an unpaid invoice (fee purpose). The school's
// active gateway decides the mode; for online modes a real provider order is
// attempted here so checkout has a concrete providerOrderId. A payer may pick
// an alternative school-enabled mode (e.g. UPI when the school publishes a
// UPI ID) — CLIENT-REQ-037.
const createOrder = async (req, res) => {
  try {
    const { invoiceId, mode } = req.body || {};
    if (!invoiceId) return res.status(400).json({ success: false, message: "invoiceId is required" });

    const invoice = await FeeInvoice.findOne({ _id: invoiceId, schoolId: req.tenantId });
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // Students may only create orders against their own invoices.
    if (req.user.role === "student" && String(invoice.studentId) !== String(req.user.refId)) {
      return res.status(403).json({ success: false, message: "Cannot create a payment for another student" });
    }

    const due = Number(invoice.amount) - Number(invoice.paidAmount || 0);
    if (due <= 0) return res.status(400).json({ success: false, message: "Invoice is already fully paid" });

    const gateway = await engine.resolveGateway(req.tenantId);
    let gatewayMode = gateway.mode;
    if (mode !== undefined && mode !== null && String(mode) !== "") {
      const requested = String(mode);
      if (!GATEWAY_MODES.includes(requested)) {
        return res.status(400).json({ success: false, message: "Unsupported payment mode" });
      }
      const upiEnabled = requested === "upi" && Boolean(gateway.display && gateway.display.upiId);
      if (requested !== gateway.mode && !upiEnabled) {
        return res.status(400).json({ success: false, message: "This payment mode is not enabled for the school" });
      }
      gatewayMode = requested;
    }

    const order = await PaymentOrder.create({
      schoolId: req.tenantId,
      invoiceId: invoice._id,
      studentId: invoice.studentId,
      admissionNo: req.user.role === "student" ? req.user.refId : invoice.studentId,
      purpose: "fee",
      gatewayMode,
      amount: due,
      currency: invoice.currency || "INR",
      provider: gatewayMode,
      providerOrderId: null,
      externalRef: `PKG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      status: "pending",
    });

    await engine.tryCreateProviderOrder(order, gateway);
    await order.save();

    res.status(201).json({
      success: true,
      data: {
        id: order._id,
        invoiceId: order.invoiceId,
        studentId: order.studentId,
        purpose: order.purpose,
        gatewayMode: order.gatewayMode,
        amount: order.amount,
        currency: order.currency,
        provider: order.provider,
        providerOrderId: order.providerOrderId,
        externalRef: order.externalRef,
        status: order.status,
        checkout: engine.buildCheckout(order, gateway),
        createdAt: order.createdAt,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Prepares checkout. Manual modes hand the payer display instructions and move
// the order to awaiting_manual_confirm (staff queue confirms it). Online modes
// need a concrete provider order; otherwise an honest 503 is returned.
const initiateOrder = async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "student" && String(order.studentId) !== String(req.user.refId)) {
      return res.status(403).json({ success: false, message: "Not your payment order" });
    }
    // pending = fresh order; failed = a provider failure event flipped it and
    // a retry may re-enter checkout when a providerOrderId exists.
    if (!["pending", "failed"].includes(order.status)) {
      return res.status(400).json({ success: false, message: `Order is already ${order.status}` });
    }

    const gateway = await engine.resolveGateway(order.schoolId);

    if (engine.MANUAL_MODES.includes(order.gatewayMode)) {
      order.status = "awaiting_manual_confirm";
      await order.save();
      return res.json({
        success: true,
        data: {
          id: order._id,
          gatewayMode: order.gatewayMode,
          amount: order.amount,
          currency: order.currency,
          status: order.status,
          checkout: engine.buildCheckout(order, gateway),
        },
      });
    }

    if (!order.providerOrderId) {
      return res.status(503).json({
        success: false,
        message: "Payment provider is not configured. Please complete payment at the school office.",
        code: "PROVIDER_NOT_CONFIGURED",
      });
    }

    order.status = "awaiting_confirmation";
    await order.save();

    res.json({
      success: true,
      data: {
        id: order._id,
        gatewayMode: order.gatewayMode,
        amount: order.amount,
        currency: order.currency,
        providerOrderId: order.providerOrderId,
        status: order.status,
        checkout: engine.buildCheckout(order, gateway),
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Client-side confirmation fallback. Only accepts a valid provider payment
// signature (Razorpay order_id|payment_id HMAC with the school's/platform key
// secret) — a forged confirm is cryptographically impossible. Webhooks remain
// the primary path.
const confirmOrder = async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.status === "completed") {
      return res.json({ success: true, data: { order, note: "Already confirmed" } });
    }
    if (!["pending", "awaiting_confirmation"].includes(order.status)) {
      return res.status(400).json({ success: false, message: `Order is ${order.status}` });
    }

    const gateway = await engine.resolveGateway(order.schoolId);
    const driver = engine.driverFor(order.gatewayMode);
    const config = engine.driverConfig(gateway, order.gatewayMode);

    const verified = await driver.verifyPaymentSignature(config, {
      razorpayOrderId: req.body?.razorpay_order_id || order.providerOrderId,
      razorpayPaymentId: req.body?.razorpay_payment_id,
      razorpaySignature: req.body?.razorpay_signature,
    });
    if (!verified) {
      return res.status(401).json({ success: false, message: "Invalid payment signature" });
    }

    const result = await engine.completeOrder(order, {
      confirmedBy: `signature:${req.body?.razorpay_payment_id || "verified"}`,
    });
    res.json({ success: true, data: { order, note: result.already ? "Already confirmed" : "Confirmed" } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Office verification queue (CLIENT-REQ-036 — closes the awaiting_manual_confirm
// dead end). Staff confirm that UPI/QR/bank/manual money actually arrived; the
// order completes through the same idempotent engine path as a webhook, and the
// ledger records the payer's real mode (MODE_ROUTING) plus their reference.
const manualConfirmOrder = async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.status === "completed") {
      return res.json({ success: true, data: { order }, note: "Already confirmed" });
    }
    if (order.status !== "awaiting_manual_confirm") {
      return res.status(400).json({ success: false, message: `Order is ${order.status} — only orders awaiting office verification can be confirmed here` });
    }

    const { mode, receivedRef, note, chequeNo, chequeDate, bankName } = req.body || {};
    const routed = engine.MODE_ROUTING[order.gatewayMode] || null;
    let paymentMode = routed;
    if (engine.MANUAL_MODES.includes(order.gatewayMode) && order.gatewayMode === "manual") {
      if (!mode) {
        return res.status(400).json({ success: false, message: "mode is required to confirm this payment" });
      }
      paymentMode = String(mode);
    } else if (mode !== undefined && mode !== null && String(mode) !== "") {
      paymentMode = String(mode);
    }
    if (!paymentMode) paymentMode = "Online Gateway";
    const validModes = Payment.schema.path("mode").enumValues;
    if (!validModes.includes(paymentMode)) {
      return res.status(400).json({ success: false, message: `Unsupported payment mode: ${paymentMode}` });
    }
    if (paymentMode === "Cheque" && !String(chequeNo || "").trim()) {
      return res.status(400).json({ success: false, message: "chequeNo is required for cheque payments" });
    }

    // Persist office evidence before completing (audit trail survives even if
    // the completion side effects fail and roll the status back).
    order.receivedRef = String(receivedRef || "").slice(0, 120) || undefined;
    order.confirmedNote = String(note || "").slice(0, 300) || undefined;
    if (chequeNo) order.evidence = { ...(order.evidence || {}), chequeNo: String(chequeNo).slice(0, 40) };
    await order.save();

    const result = await engine.completeOrder(order, {
      confirmedBy: `manual:${req.user.name || req.user.email || "staff"}`,
      paymentExtras: {
        mode: paymentMode,
        receivedRef: order.receivedRef,
        chequeNo,
        chequeDate,
        bankName,
      },
    });
    const confirmed = await PaymentOrder.findById(order._id);
    res.json({ success: true, data: { order: confirmed }, note: result.already ? "Already confirmed" : "Confirmed" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const cancelOrder = async (req, res) => {
  try {
    const order = await PaymentOrder.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "student" && String(order.studentId) !== String(req.user.refId)) {
      return res.status(403).json({ success: false, message: "Not your payment order" });
    }
    if (order.status === "completed") {
      return res.status(400).json({ success: false, message: "Completed orders cannot be cancelled" });
    }
    order.status = "cancelled";
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getOrders = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    if (req.user.role === "student") filter.studentId = req.user.refId;
    else if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.invoiceId) filter.invoiceId = req.query.invoiceId;

    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      PaymentOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PaymentOrder.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createOrder, initiateOrder, confirmOrder, manualConfirmOrder, cancelOrder, getOrders };
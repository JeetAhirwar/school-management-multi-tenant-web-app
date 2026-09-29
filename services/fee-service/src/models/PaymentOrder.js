const mongoose = require("mongoose");

const paymentOrderSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    // For fee payments the order is linked to an invoice; for subscription
    // upgrades there is no invoice (created via the internal engine route).
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "FeeInvoice", default: null },
    studentId: { type: String, index: true },
    admissionNo: { type: String, index: true },
    purpose: {
      type: String,
      enum: ["fee", "subscription_upgrade"],
      default: "fee",
      index: true,
    },
    gatewayMode: {
      type: String,
      enum: ["platform", "razorpay", "stripe", "phonepe", "upi", "qr", "bank", "manual"],
      default: "platform",
    },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "INR" },
    provider: { type: String, default: "unconfigured" },
    providerOrderId: { type: String, index: true },
    externalRef: { type: String },
    status: {
      type: String,
      enum: [
        "pending",
        "awaiting_confirmation",
        "awaiting_manual_confirm",
        "completed",
        "failed",
        "cancelled",
      ],
      default: "pending",
    },
    // For manual modes (upi/qr/bank/manual): the UTR/reference the payer
    // submits, plus staff verification evidence (screenshot, note).
    receivedRef: { type: String },
    evidence: { type: String },
    confirmedNote: { type: String },
    // This is intentionally only settable by the authenticated provider
    // confirm path (signed webhook or client payment signature). There is no
    // client-accessible route that flips this without a valid signature.
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: String, default: null },
    // purpose-specific payload (e.g. { planId, durationPeriods } for subscription_upgrade).
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

paymentOrderSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
paymentOrderSchema.index({ providerOrderId: 1, gatewayMode: 1 });

module.exports = mongoose.model("PaymentOrder", paymentOrderSchema);
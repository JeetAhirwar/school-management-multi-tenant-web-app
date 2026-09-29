const mongoose = require("mongoose");

const AUDIT_ENTRY_SCHEMA = new mongoose.Schema(
  {
    action: { type: String, required: true },
    by: { type: String },
    note: { type: String },
  },
  { timestamps: { createdAt: "at" } }
);

// One gateway configuration per school. `mode` selects how the school
// collects money (see shared/src/payment-gateways for the driver contract).
// Secret provider values are stored encrypted via utils/gatewayCrypto and are
// never returned to the client — only masked+isConfigured.
const paymentGatewaySchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      unique: true,
      index: true,
    },
    mode: {
      type: String,
      enum: ["platform", "razorpay", "stripe", "phonepe", "upi", "qr", "bank", "manual"],
      default: "platform",
    },
    status: {
      type: String,
      enum: ["draft", "pending_verification", "active", "disabled"],
      default: "active",
    },
    statusReason: { type: String },
    providers: {
      razorpay: {
        keyId: { type: String },
        keySecret: { type: String }, // encrypted
        webhookSecret: { type: String }, // encrypted
        testMode: { type: Boolean, default: false },
      },
      stripe: {
        publishableKey: { type: String },
        secretKey: { type: String }, // encrypted
        webhookSecret: { type: String }, // encrypted
        testMode: { type: Boolean, default: false },
      },
      phonepe: {
        merchantId: { type: String },
        saltKey: { type: String }, // encrypted
        saltIndex: { type: String },
        env: { type: String, enum: ["prod", "uat"], default: "uat" },
      },
    },
    display: {
      upiId: { type: String, trim: true },
      qrCodeUrl: { type: String },
      qrCodeData: { type: String },
      bankName: { type: String },
      accountHolder: { type: String },
      accountNumber: { type: String },
      ifsc: { type: String },
      accountType: { type: String },
      instructions: { type: String },
    },
    // Masked secret values, purely for showing "what is configured" in the UI.
    maskedKeys: { type: mongoose.Schema.Types.Mixed, default: {} },
    verified: {
      at: { type: Date, default: null },
      by: { type: String },
      note: { type: String },
    },
    testedAt: { type: Date, default: null },
    audit: { type: [AUDIT_ENTRY_SCHEMA], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentGateway", paymentGatewaySchema);
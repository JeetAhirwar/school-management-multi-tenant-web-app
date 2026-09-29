const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "FeeInvoice", required: true },
    studentId: { type: String, required: true },
    amount: { type: Number, required: true },
    mode: { type: String, enum: ["Cash", "Card", "UPI", "Net Banking", "Bank Transfer", "Cheque", "Online Gateway"], required: true },
    transactionId: { type: String },
    receiptNo: { type: String, required: true },
    paidOn: { type: Date, default: Date.now },
    collectedBy: { type: String },
    // Office-verified manual payments (CLIENT-REQ-037/039): payer's reference
    // plus cheque clearance lifecycle. clearanceStatus is only set for Cheque.
    receivedRef: { type: String },
    chequeNo: { type: String },
    chequeDate: { type: Date },
    bankName: { type: String },
    clearanceStatus: { type: String, enum: ["Pending", "Cleared", "Bounced"] },
    clearedAt: { type: Date },
    clearedBy: { type: String },
    bouncedReason: { type: String },
    bouncedBy: { type: String },
    bouncedAt: { type: Date },
  },
  { timestamps: true }
);

// Receipt numbers must be unique per tenant (GET /receipt/:receiptNo would
// otherwise silently return the first of two colliding rows).
paymentSchema.index({ schoolId: 1, receiptNo: 1 }, { unique: true });
// Duplicate payment references are rejected at the database (partial index:
// legacy/optional transactionIds stay unindexed only when absent/empty).
paymentSchema.index(
  { schoolId: 1, transactionId: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: "string", $gt: "" } } }
);

module.exports = mongoose.model("Payment", paymentSchema);

const mongoose = require("mongoose");

// Platform billing invoice. invoiceNumber is globally unique (collision-safe
// random suffix + unique index). Amount mirrors the subscription price snapshot.
// Snapshot fields (planName, planCode, etc.) are populated at creation time for
// historical accuracy — they are never updated after initial insert.
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR", uppercase: true, trim: true },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    gstRate: { type: Number, default: 0, min: 0 },
    cgstAmount: { type: Number, default: 0, min: 0 },
    sgstAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["draft", "issued", "paid", "void", "overdue"], default: "issued", index: true },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    dueDate: { type: Date },
    paidAt: { type: Date },
    // Snapshot fields — immutable after creation
    planName: { type: String, trim: true },
    planCode: { type: String, trim: true },
    durationPeriods: { type: Number, default: 1, min: 1 },
    schoolName: { type: String, trim: true },
    schoolCode: { type: String, trim: true },
    paymentOrderId: { type: String, trim: true },
  },
  { timestamps: true }
);

invoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ schoolId: 1, status: 1 });
invoiceSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model("BillingInvoice", invoiceSchema);
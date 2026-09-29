const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true },
    class: { type: String },
    feeType: { type: String, required: true },
    session: { type: String, required: true },
    amount: { type: Number, required: true }, // net payable (after concession)
    // Concession snapshot (CLIENT-REQ-045/046/047): amount = grossAmount -
    // concessionAmount. Legacy invoices carry only `amount` (fallback).
    grossAmount: { type: Number },
    concessionAmount: { type: Number, default: 0 },
    concessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Concession" },
    paidAmount: { type: Number, default: 0 },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ["Unpaid", "Partial", "Paid", "Overdue"], default: "Unpaid" },
    receiptNo: { type: String },
  },
  { timestamps: true }
);

// One invoice per student per fee head per session — enforced in the database
// so concurrent bulk generates cannot race past the application-level dedupe.
invoiceSchema.index({ schoolId: 1, studentId: 1, feeType: 1, session: 1 }, { unique: true });

module.exports = mongoose.model("FeeInvoice", invoiceSchema);

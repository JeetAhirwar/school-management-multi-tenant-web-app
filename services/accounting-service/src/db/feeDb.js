const mongoose = require("mongoose");

// Read-only mirror of the fee-service Payment collection. The accounting
// ledger sweeper (a cron inside accounting-service) scans receipts and cheque
// clearance changes without touching fee-service write paths — the fee
// service remains the source of truth for payments.

const paymentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId },
    studentId: { type: String },
    amount: { type: Number },
    mode: { type: String },
    receiptNo: { type: String },
    paidOn: { type: Date },
    clearanceStatus: { type: String },
    bouncedAt: { type: Date },
  },
  { timestamps: true, collection: "payments" }
);

let paymentModel = null;

async function getPaymentModel() {
  if (paymentModel) return paymentModel;
  if (!process.env.FEE_MONGODB_URI) {
    throw new Error("FEE_MONGODB_URI is not configured");
  }
  const connection = mongoose.createConnection(process.env.FEE_MONGODB_URI, {
    serverSelectionTimeoutMS: 4000,
    bufferCommands: false,
  });
  await connection.asPromise();
  paymentModel = connection.model("Payment", paymentSchema);
  return paymentModel;
}

module.exports = { getPaymentModel };

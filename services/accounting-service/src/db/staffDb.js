const mongoose = require("mongoose");

// Read-only mirror of the staff-service Payroll collection. Only Paid rows
// produce journal entries (cash-basis posting at markPaid).

const payrollSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, required: true },
    staffId: { type: mongoose.Schema.Types.ObjectId },
    month: { type: String },
    year: { type: Number },
    netPay: { type: Number },
    status: { type: String },
    paidOn: { type: Date },
  },
  { timestamps: true, collection: "payrolls" }
);

let payrollModel = null;

async function getPayrollModel() {
  if (payrollModel) return payrollModel;
  if (!process.env.STAFF_MONGODB_URI) {
    throw new Error("STAFF_MONGODB_URI is not configured");
  }
  const connection = mongoose.createConnection(process.env.STAFF_MONGODB_URI, {
    serverSelectionTimeoutMS: 4000,
    bufferCommands: false,
  });
  await connection.asPromise();
  payrollModel = connection.model("Payroll", payrollSchema);
  return payrollModel;
}

module.exports = { getPayrollModel };

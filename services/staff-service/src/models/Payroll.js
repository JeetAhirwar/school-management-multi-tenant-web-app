const mongoose = require("mongoose");

const payrollSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    month: { type: String, required: true }, // e.g. "September"
    year: { type: Number, required: true },
    basic: { type: Number, required: true },
    allowances: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    deductionReason: { type: String, default: "" },
    // Opt-in attendance linkage: when generatePayroll/generateAllPayroll run
    // with adjustForAttendance, the unauthorised-absence deduction folded
    // into `deductions` is recorded here for transparency.
    attendanceDeduction: { type: Number, default: 0 },
    attendancePct: { type: Number, default: null },
    netPay: { type: Number, required: true },
    status: { type: String, enum: ["Pending", "Paid"], default: "Pending" },
    paidOn: { type: Date },
  },
  { timestamps: true }
);

payrollSchema.index({ schoolId: 1, staffId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("Payroll", payrollSchema);

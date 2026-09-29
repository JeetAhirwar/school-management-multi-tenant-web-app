const mongoose = require("mongoose");
const { computeResultWith, resolveScale } = require("../utils/grading");

const marksSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true }, // admissionNo (canonical student identity)
    examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
    examName: { type: String, required: true },
    class: { type: String, required: true },
    section: { type: String, default: "" },
    session: { type: String, index: true }, // academic year label e.g. "2026-27"
    subject: { type: String, required: true },
    marksObtained: { type: Number, required: true },
    maxMarks: { type: Number, required: true },
    // Pass percentage snapshot (resolved from the exam's explicit value or
    // the school's active GradingScale at write time). Null only on legacy
    // rows created before the scale subsystem.
    passingMarks: { type: Number, default: null },
    pct: { type: Number },
    grade: { type: String },
    passed: { type: Boolean },
    remarks: { type: String },
  },
  { timestamps: true }
);

marksSchema.index({ schoolId: 1, studentId: 1, examId: 1, subject: 1 }, { unique: true });
marksSchema.index({ schoolId: 1, examId: 1 });
marksSchema.index({ schoolId: 1, session: 1 });

// Derive grade/pct/passed from the tenant's ACTIVE grading scale so seeded
// rows, API rows and manual saves all stay consistent with the configured
// scale (fallback: built-in default scale — identical to the legacy rules).
marksSchema.pre("save", async function () {
  const scale = await resolveScale(this.schoolId);
  const passingMarks =
    this.passingMarks == null ? (scale.passPct != null ? scale.passPct : 33) : this.passingMarks;
  const result = computeResultWith(scale, this.marksObtained, this.maxMarks, passingMarks);
  this.passingMarks = passingMarks;
  this.pct = +result.pct.toFixed(2);
  this.grade = result.grade;
  this.passed = result.passed;
});

module.exports = mongoose.model("Marks", marksSchema);
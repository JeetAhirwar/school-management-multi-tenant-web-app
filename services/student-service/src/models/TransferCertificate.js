const mongoose = require("mongoose");

// School-issued Transfer Certificate (Phase 2). A TC is a point-in-time legal
// document: `snapshot` captures the student's details at issue so later
// profile edits never rewrite an issued certificate. One TC per student per
// school — a reprint re-downloads the same tcNumber's PDF.
const transferCertificateSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    tcNumber: { type: String, required: true, trim: true },
    studentId: { type: String, required: true, index: true }, // admissionNo (refId)
    issueDate: { type: Date, default: Date.now },
    leavingDate: { type: Date, default: null },
    reason: { type: String, trim: true, default: "" },
    conduct: { type: String, trim: true, default: "Good" },
    remarks: { type: String, trim: true, default: "" },
    issuedBy: { type: String }, // issuer User refId
    issuedByName: { type: String }, // issuer display name
    snapshot: {
      name: { type: String, default: "" },
      admissionNo: { type: String, default: "" },
      class: { type: String, default: "" },
      section: { type: String, default: "" },
      gender: { type: String, default: "" },
      dob: { type: Date, default: null },
      parentName: { type: String, default: "" },
      motherName: { type: String, default: "" },
      admissionDate: { type: Date, default: null },
    },
  },
  { timestamps: true },
);
transferCertificateSchema.index({ schoolId: 1, tcNumber: 1 }, { unique: true });
transferCertificateSchema.index({ schoolId: 1, studentId: 1 }, { unique: true });

// Per-school, per-calendar-year TC sequence → "TC-2026-0001". $inc is atomic;
// a rare concurrent-upsert E11000 is retried by the allocator.
const tcCounterSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, required: true },
    year: { type: Number, required: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);
tcCounterSchema.index({ schoolId: 1, year: 1 }, { unique: true });

const TransferCertificate =
  mongoose.models.TransferCertificate ||
  mongoose.model("TransferCertificate", transferCertificateSchema);
const TcCounter = mongoose.models.TcCounter || mongoose.model("TcCounter", tcCounterSchema);

module.exports = { TransferCertificate, TcCounter };

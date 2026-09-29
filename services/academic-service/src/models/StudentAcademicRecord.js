const mongoose = require("mongoose");

// Immutable academic history row. Written when a student is promoted,
// in-year transferred (class/section change), school-transferred, or
// graduated for a given academic session. Existing rows are NEVER mutated:
// they lock in the from-class/from-section snapshot at the time of the move
// so historical records survive later class changes.
const recordSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true }, // admissionNo (canonical identity)
    studentName: { type: String },
    session: { type: String }, // the academic year the move occurred in (optional for in-year transfers)
    kind: {
      type: String,
      enum: ["promotion", "transfer"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "Promoted",
        "Promoted with Conditions",
        "Detained",
        "Transferred",
        "Graduated",
      ],
      required: true,
    },
    fromClass: { type: String },
    fromSection: { type: String },
    toClass: { type: String },
    toSection: { type: String },
    // Frozen result summary for the session at move time (best marks per
    // subject across the session's published exams).
    summary: {
      totalObtained: { type: Number },
      totalMax: { type: Number },
      percentage: { type: Number },
      failedSubjects: { type: Number },
      subjects: [new mongoose.Schema(
        {
          subject: { type: String },
          marksObtained: { type: Number },
          maxMarks: { type: Number },
          passed: { type: Boolean },
        },
        { _id: false },
      )],
    },
    remarks: { type: String },
    actedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actedByName: { type: String },
  },
  { timestamps: true },
);

// One promotion per student per session (duplicate promotion prevention).
recordSchema.index(
  { schoolId: 1, studentId: 1, session: 1, kind: 1 },
  { unique: true },
);

module.exports = mongoose.model("StudentAcademicRecord", recordSchema);
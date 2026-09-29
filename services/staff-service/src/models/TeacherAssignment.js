const mongoose = require("mongoose");

// Teacher vs Class Teacher is decided by ASSIGNMENTS, not by the auth role.
// Every Class Teacher is a Teacher; a Teacher only becomes a Class Teacher for
// a specific class/section/session when an explicit class_teacher assignment is
// created. Assignments are session-scoped and soft-ended so history is kept.
const teacherAssignmentSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true,
    },
    // Denormalized snapshot for display and audit history (kept after a staff
    // record is soft-deactivated or renamed).
    staffName: { type: String, trim: true, default: "" },
    // Academic session key, e.g. "2026-27". Session values are scoped strings,
    // never ObjectIds, and are required so historical data can never be
    // silently reassigned just because the current session changed.
    session: { type: String, required: true, trim: true },
    type: { type: String, enum: ["teaching", "class_teacher"], required: true },
    // Required when type === "teaching"; always null when type === "class_teacher".
    subject: { type: String, trim: true, default: null },
    class: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
    status: { type: String, enum: ["active", "ended"], default: "active" },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// At most ONE active Class Teacher per (school, session, class, section).
teacherAssignmentSchema.index(
  { schoolId: 1, session: 1, class: 1, section: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active", type: "class_teacher" },
    name: "uniq_active_class_teacher",
  },
);

// A teacher cannot hold the SAME active teaching assignment twice
// (school, staff, session, subject, class, section).
teacherAssignmentSchema.index(
  { schoolId: 1, staffId: 1, session: 1, subject: 1, class: 1, section: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active", type: "teaching" },
    name: "uniq_active_teaching",
  },
);

module.exports = mongoose.model("TeacherAssignment", teacherAssignmentSchema);
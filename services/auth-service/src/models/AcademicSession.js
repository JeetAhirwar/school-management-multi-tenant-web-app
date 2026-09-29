const mongoose = require("mongoose");

// Structured academic-session calendar for a tenant (school). This is the
// Phase 2 source of truth for "which session is current" while the legacy
// School.session STRING is kept in sync (see academicSessionController) and
// remains the value that fee structures / teacher assignments / display copy
// historically use. Existing session strings are never rewritten.
//
// Rules enforced by schema/indexes:
//  - tenant-scoped (schoolId)
//  - at most ONE current session per school (partial unique index)
//  - unique name per school
//  - endDate strictly after startDate (pre-validate hook)
const academicSessionSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // planned -> active -> ended. "active" is only ever set together with
    // isCurrent=true; the previous current session is moved to "ended" when a
    // new session takes over.
    status: {
      type: String,
      enum: ["planned", "active", "ended"],
      default: "planned",
    },
    isCurrent: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

academicSessionSchema.index({ schoolId: 1, name: 1 }, { unique: true });
academicSessionSchema.index(
  { schoolId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
);
academicSessionSchema.index({ schoolId: 1, startDate: 1, endDate: 1 });
academicSessionSchema.index({ status: 1 });

academicSessionSchema.pre("validate", function (next) {
  if (this.startDate && this.endDate && this.endDate.getTime() <= this.startDate.getTime()) {
    return next(new Error("endDate must be after startDate"));
  }
  next();
});

module.exports = mongoose.model("AcademicSession", academicSessionSchema);
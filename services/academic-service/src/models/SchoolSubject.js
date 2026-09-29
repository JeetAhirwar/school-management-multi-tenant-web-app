const mongoose = require("mongoose");
const { mkKey } = require("../utils/normalize");

// School-owned subject master.
//
// Every subject belongs to exactly one school (schoolId set from the auth
// context). The legacy `scope` field is kept for DB compatibility with
// pre-migration rows:
//
//   scope = "tenant"        -> a school/tenant-specific subject (schoolId set)
//   scope = "global"        -> legacy platform row (schoolId null); never newly
//                              created and never returned to tenants anymore
//
// The schoolId filter on every read already hides any leftover global rows, so
// old data stays in the collection without surfacing anywhere.
const schoolSubjectSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ["global", "tenant"], default: "tenant", index: true },
    // Tenant-scoped subjects set schoolId; legacy global subjects leave it null.
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null, index: true },
    // "" = school-wide subject; otherwise the class code (e.g. "11-Sci") the
    // subject is scoped to. Preserves class-subject relationships where used.
    className: { type: String, default: "", trim: true },
    name: { type: String, required: true, trim: true },
    // normalizedName = lowercase(trim(collapseWhitespace(name))) — the logical
    // uniqueness key within its scope.
    normalizedName: { type: String, required: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    description: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

schoolSubjectSchema.pre("validate", function (next) {
  if (this.name) {
    this.normalizedName = String(this.name)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  if (this.scope === "global") {
    this.schoolId = null;
    this.tenantId = null;
  }
  next();
});

// Unique tenant-scoped name (schoolId + className + normalizedName).
schoolSubjectSchema.index(
  { scope: 1, schoolId: 1, className: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { scope: "tenant" } }
);
// Legacy global uniqueness index (pre-migration rows only; no new global rows
// are ever created). Kept so removing it would not require a collection
// re-index, and so legacy duplicates stay impossible for any direct writes.
schoolSubjectSchema.index(
  { scope: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { scope: "global" } }
);

module.exports = mongoose.model("SchoolSubject", schoolSubjectSchema);
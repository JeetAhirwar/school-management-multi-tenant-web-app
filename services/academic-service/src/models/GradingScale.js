const mongoose = require("mongoose");
const { mkKey } = require("../utils/normalize");
const { validateScaleBands } = require("../utils/gradingPresets");

// A tenant's grading scale: ordered bands (grade label + minimum percentage)
// plus the pass percentage. Exactly ONE row per school may be isDefault —
// that row is the active scale every grade computation resolves through
// (partial unique index enforces it at the DB level, mirroring
// AcademicSession.isCurrent).
const gradingScaleSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    system: { type: String, enum: ["default", "cbse", "icse", "custom"], default: "custom" },
    bands: [
      {
        _id: false,
        grade: { type: String, required: true, trim: true },
        minPct: { type: Number, required: true, min: 0, max: 100 },
      },
    ],
    passPct: { type: Number, default: 33, min: 0, max: 100 },
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

gradingScaleSchema.pre("validate", function (next) {
  this.key = mkKey(this.name);
  const err = validateScaleBands(this.bands);
  if (err) return next(new Error(err));
  next();
});

gradingScaleSchema.index({ schoolId: 1, key: 1 }, { unique: true });
gradingScaleSchema.index(
  { schoolId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

module.exports = mongoose.model("GradingScale", gradingScaleSchema);

const mongoose = require("mongoose");
const { mkKey } = require("../utils/normalize");

const feeTypeSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

feeTypeSchema.pre("validate", function (next) {
  this.key = mkKey(this.name);
  next();
});

feeTypeSchema.index({ schoolId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("FeeType", feeTypeSchema);

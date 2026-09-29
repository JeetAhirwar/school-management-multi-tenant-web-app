const mongoose = require("mongoose");
const { mkKey } = require("../utils/normalize");

const hostelBlockSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

hostelBlockSchema.pre("validate", function (next) {
  this.key = mkKey(this.name);
  next();
});

hostelBlockSchema.index({ schoolId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("HostelBlock", hostelBlockSchema);
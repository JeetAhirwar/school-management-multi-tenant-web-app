const mongoose = require("mongoose");

const referenceDataSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      enum: ["board", "recognition_authority", "city", "state"],
      index: true,
    },
    value: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

referenceDataSchema.index({ category: 1, value: 1 }, { unique: true });

module.exports = mongoose.model("ReferenceData", referenceDataSchema);

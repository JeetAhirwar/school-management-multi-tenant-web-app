const mongoose = require("mongoose");

// 24h "HH:MM" slot; display label keeps the school-friendly 12h range used by
// the rest of the Exam UI. Storage stays normalized (startTime/endTime) so
// ordering/comparisons are safe across tenants.
const timeSlotSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    startTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:MM (24h)"],
    },
    endTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "endTime must be HH:MM (24h)"],
    },
    label: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

timeSlotSchema.index({ schoolId: 1, startTime: 1, endTime: 1 }, { unique: true });

module.exports = mongoose.model("TimeSlot", timeSlotSchema);
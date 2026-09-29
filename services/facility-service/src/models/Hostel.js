const mongoose = require("mongoose");

const hostelSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    roomNo: { type: String, required: true },
    block: { type: String, required: true },
    floor: { type: Number, default: 1 },
    wing: { type: String, enum: ["Boys", "Girls"], default: "Boys" },
    capacity: { type: Number, required: true },
    occupants: [{ type: String }], // studentIds
    warden: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Hostel", hostelSchema);

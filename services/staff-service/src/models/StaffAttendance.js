const mongoose = require("mongoose");

const staffAttendanceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    staffId: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    status: {
      type: String,
      enum: ["Present", "Absent", "Leave", "Half Day", "Late"],
      required: true,
    },
    checkIn: { type: String, default: null }, // HH:mm
    checkOut: { type: String, default: null }, // HH:mm
    note: { type: String, default: null },
    markedBy: { type: String },
    source: { type: String, enum: ["self", "admin"], default: "admin" },
    originalStatus: { type: String, default: null },
    correctedBy: { type: String, default: null },
    correctedAt: { type: Date, default: null },
    correctionReason: { type: String, default: null },
  },
  { timestamps: true }
);

staffAttendanceSchema.index({ schoolId: 1, staffId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("StaffAttendance", staffAttendanceSchema);

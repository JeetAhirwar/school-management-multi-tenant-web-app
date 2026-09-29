const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true },
    class: { type: String, required: true },
    section: { type: String, required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ["Present", "Absent", "Leave", "Half Day"], required: true },
    remarks: { type: String },
    markedBy: { type: String },
  },
  { timestamps: true }
);

attendanceSchema.index({ schoolId: 1, studentId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);

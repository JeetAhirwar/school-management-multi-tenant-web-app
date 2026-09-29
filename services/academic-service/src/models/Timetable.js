const mongoose = require("mongoose");

const periodSchema = new mongoose.Schema(
  {
    subject: String,
    teacherId: String,
    teacherName: String,
    roomId: { type: String, default: "" },
    roomName: { type: String, default: "" },
    startTime: String,
    endTime: String,
  },
  { _id: false }
);

const timetableSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    class: { type: String, required: true },
    section: { type: String, required: true },
    day: {
      type: String,
      enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      required: true,
    },
    periods: [periodSchema],
  },
  { timestamps: true }
);

timetableSchema.index({ schoolId: 1, class: 1, section: 1, day: 1 }, { unique: true });

module.exports = mongoose.model("Timetable", timetableSchema);

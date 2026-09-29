const mongoose = require("mongoose");

// A substitution re-assigns ONE timetable period (class, section, date,
// start/end) from the original teacher to a substitute. The period details
// (subject, room, original teacher) are derived from the class timetable at
// creation time so a substitution can never drift from the published schedule.
const substitutionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"],
      index: true,
    },
    day: {
      type: String,
      enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      required: true,
    },
    class: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
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
    subject: { type: String, default: "" },
    originalTeacherId: { type: String, required: true },
    originalTeacherName: { type: String, default: "" },
    substituteTeacherId: { type: String, required: true },
    substituteTeacherName: { type: String, default: "" },
    roomId: { type: String, default: "" },
    roomName: { type: String, default: "" },
    reason: { type: String, default: "", maxlength: 500 },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled"],
      default: "scheduled",
    },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// One substitution per class-period slot (a repeat request is a duplicate,
// not a second coverage record).
substitutionSchema.index(
  { schoolId: 1, date: 1, class: 1, section: 1, startTime: 1 },
  { unique: true }
);

module.exports = mongoose.model("Substitution", substitutionSchema);

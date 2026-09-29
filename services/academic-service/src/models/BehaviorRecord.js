const mongoose = require("mongoose");

const behaviorRecordSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true, index: true },
    class: { type: String, required: true },
    section: { type: String },
    date: { type: Date, required: true },
    type: {
      type: String,
      enum: ["incident", "positive", "warning", "detention", "suspension", "other"],
      default: "incident",
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    actionTaken: { type: String, trim: true },
    reportedBy: { type: String },
    reportedByRole: { type: String },
    witnesses: [{ type: String, trim: true }],
    followUpRequired: { type: Boolean, default: false },
    followUpNotes: { type: String, trim: true },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

behaviorRecordSchema.index({ schoolId: 1, studentId: 1, date: -1 });
behaviorRecordSchema.index({ schoolId: 1, class: 1, section: 1, date: -1 });

module.exports = mongoose.model("BehaviorRecord", behaviorRecordSchema);

const mongoose = require("mongoose");

const syllabusSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    class: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    term: { type: String, enum: ["Term 1", "Term 2", "Full Year"], default: "Full Year" },
    topics: [
      {
        title: { type: String, required: true },
        description: { type: String, default: "" },
        status: { type: String, enum: ["pending", "completed", "in_progress"], default: "pending" },
      },
    ],
    totalHours: { type: Number, default: 0 },
    completedHours: { type: Number, default: 0 },
  },
  { timestamps: true }
);

syllabusSchema.index({ schoolId: 1, class: 1, subject: 1 });

module.exports = mongoose.model("Syllabus", syllabusSchema);

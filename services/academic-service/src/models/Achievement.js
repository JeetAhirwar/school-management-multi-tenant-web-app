const mongoose = require("mongoose");

const achievementSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true, index: true },
    class: { type: String },
    section: { type: String },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    category: {
      type: String,
      enum: ["academic", "sports", "arts", "citizenship", "attendance", "other"],
      default: "academic",
    },
    description: { type: String, trim: true },
    date: { type: Date, required: true },
    awardedBy: { type: String },
    awardedByRole: { type: String },
    certificateUrl: { type: String },
    year: { type: Number },
  },
  { timestamps: true }
);

achievementSchema.index({ schoolId: 1, studentId: 1, date: -1 });
achievementSchema.index({ schoolId: 1, class: 1, section: 1, date: -1 });

module.exports = mongoose.model("Achievement", achievementSchema);

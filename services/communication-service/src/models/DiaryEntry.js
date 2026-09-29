const mongoose = require("mongoose");

// Digital diary: a class-teacher's daily note to that class's students and
// parents (what happened today, homework reminders, etc). One doc per class-
// section per post; reads are scoped by class/section like notices.
const diaryEntrySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    class: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
    date: { type: Date, default: Date.now },
    postedBy: { type: String, default: null },
  },
  { timestamps: true },
);

diaryEntrySchema.index({ schoolId: 1, class: 1, section: 1, date: -1 });

module.exports = mongoose.model("DiaryEntry", diaryEntrySchema);

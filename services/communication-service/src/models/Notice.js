const mongoose = require("mongoose");

const noticeSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, default: "General" },
    pinned: { type: Boolean, default: false },
    audience: [
      {
        type: String,
        // "class_teacher" is retained only as a legacy value for documents
        // written before the role collapse; new audiences use "teacher".
        enum: ["school_admin", "class_teacher", "teacher", "staff", "student", "parent", "all"],
        default: "all",
      },
    ],
    // Optional class-section targeting ("5-A"): when non-empty the notice only
    // reaches students of those classes and parents linked to them (on top of
    // the audience role filter). Empty = whole audience.
    classTags: [{ type: String, trim: true }],
    // "emergency" notices render as priority alerts and fan out with the
    // emergency notification kind (multi-channel: in-app always, email when
    // SMTP is configured).
    priority: { type: String, enum: ["normal", "emergency"], default: "normal" },
    postedBy: { type: String },
    attachments: [{ type: String }],
    expiryDate: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Notice", noticeSchema);

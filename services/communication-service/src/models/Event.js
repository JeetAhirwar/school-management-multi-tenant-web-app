const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    category: { type: String, default: "Other" },
    time: { type: String },
    image: { type: String },
    date: { type: Date, required: true },
    venue: { type: String },
    audience: [
      {
        type: String,
        // "class_teacher" is retained only as a legacy value for documents
        // written before the role collapse; new audiences use "teacher".
        enum: ["school_admin", "class_teacher", "teacher", "staff", "student", "parent", "all"],
        default: "all",
      },
    ],
    createdBy: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Event", eventSchema);

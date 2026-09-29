const mongoose = require("mongoose");

const homeworkSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    assignType: { type: String, enum: ["student", "staff"], default: "student" },
    class: { type: String },
    section: { type: String },
    subject: { type: String },
    title: { type: String, required: true },
    description: { type: String },
    assignedTo: { type: String },
    assignedToRole: { type: String },
    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    priority: { type: String, enum: ["Low", "Medium", "High"], default: "Medium" },
    status: { type: String, enum: ["Pending", "In Progress", "Completed", "Overdue"], default: "Pending" },
    assignedBy: { type: String },
    assignedDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    maxMarks: { type: Number, default: 10 },
    attachments: [{ type: String }],
  },
  { timestamps: true }
);

// Hot list query: tenant + class/section scope.
homeworkSchema.index({ schoolId: 1, class: 1, section: 1 });

module.exports = mongoose.model("Homework", homeworkSchema);

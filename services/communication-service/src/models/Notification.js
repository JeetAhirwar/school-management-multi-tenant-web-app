const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, default: null },
    // fee_reminder MUST stay in the enum: fee-service pushes kind
    // "fee_reminder" and mongoose insertMany validates before writing
    // (an unknown kind silently rejects the whole batch).
    kind: { type: String, enum: ["notice", "leave", "payroll", "student", "staff", "homework", "exam", "profile", "event", "system", "enquiry", "fee_reminder", "emergency", "diary", "message", "sms"], default: "system" },
    link: { type: String, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ schoolId: 1, userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
const mongoose = require("mongoose");

// Sent-once ledger for fee reminders (CLIENT-REQ-042). The unique index on
// {schoolId, invoiceId, channel, kind} is the exactly-once mechanism: the cron
// claims a reminder by inserting here first — a duplicate insert (11000) means
// someone already sent it, so the run skips. The claim is released (deleted)
// when the notification push fails, so the next run can retry delivery.
const feeReminderSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "FeeInvoice", required: true },
    studentId: { type: String, required: true },
    channel: { type: String, enum: ["inapp"], default: "inapp" },
    kind: { type: String, enum: ["due_soon", "overdue"], required: true },
    recipientCount: { type: Number, default: 0 },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

feeReminderSchema.index({ schoolId: 1, invoiceId: 1, channel: 1, kind: 1 }, { unique: true });

module.exports = mongoose.model("FeeReminder", feeReminderSchema);

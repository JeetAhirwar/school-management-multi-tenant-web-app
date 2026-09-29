const mongoose = require("mongoose");

// Broadcast audit trail (CLIENT-REQ-059/060): every SMS/email blast is logged
// with what went out, how many recipients were reached, and whether the
// provider was actually live or dry-running.
const messageLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    channel: { type: String, enum: ["sms", "email"], required: true },
    subject: { type: String, default: null },
    body: { type: String, required: true },
    audience: [{ type: String }],
    recipients: [{ type: String }],
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    dryRun: { type: Boolean, default: false },
    status: { type: String, enum: ["sent", "partial", "failed", "dry_run"], default: "sent" },
    createdBy: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

messageLogSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model("MessageLog", messageLogSchema);

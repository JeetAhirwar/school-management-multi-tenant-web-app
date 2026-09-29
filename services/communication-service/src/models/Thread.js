const mongoose = require("mongoose");

// Parent <-> class-teacher messaging thread about ONE student. Messages are
// embedded (conversations are short); access is derived at request time from
// parent linkedStudentIds / class-teacher assignment / school_admin, never
// stored on the thread (a stale participant list must not outlive the actual
// relationship).
const messageSchema = new mongoose.Schema(
  {
    senderId: { type: String, required: true },
    senderRole: { type: String, required: true },
    senderName: { type: String, default: "" },
    body: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const threadSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    // Student admissionNo (refId) — the child the thread is about.
    studentId: { type: String, required: true, index: true },
    subject: { type: String, required: true, trim: true },
    messages: [messageSchema],
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

threadSchema.index({ schoolId: 1, studentId: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Thread", threadSchema);

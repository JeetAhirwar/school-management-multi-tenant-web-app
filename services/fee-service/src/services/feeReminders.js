const FeeInvoice = require("../models/FeeInvoice");
const FeeReminder = require("../models/FeeReminder");
const { getUserModel } = require("../db/authDb");
const { notifyByRefIds, sendEmailViaAuth } = require("../utils/notify");

const REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DUE_SOON_WINDOW_DAYS = 3;
const BATCH_LIMIT = 500;

const isDupKey = (err) => err && err.code === 11000;

// Resolve the login refIds (and email addresses) that should hear about this
// invoice: the student's own user (refId = admissionNo) plus every
// parent/guardian user linked to the student (linkedStudentIds contains the
// admissionNo). Fail-soft on the cross-DB mirror — no recipients means no
// send, never a crash.
const resolveRecipients = async (schoolId, studentId) => {
  try {
    const User = await getUserModel();
    const users = await User.find({
      schoolId,
      isActive: true,
      $or: [{ refId: studentId }, { linkedStudentIds: studentId }],
    })
      .select({ refId: 1, email: 1 })
      .lean();
    return {
      refIds: [...new Set(users.map((u) => u.refId).filter(Boolean))],
      emails: [...new Set(users.map((u) => u.email).filter(Boolean))],
    };
  } catch (err) {
    console.error("[fee-reminders] recipient lookup skipped:", err.message);
    return { refIds: [], emails: [] };
  }
};

// Send in-app fee reminders exactly once per invoice per kind (CLIENT-REQ-042).
// Claim -> push -> release-on-failure ordering: the unique index guarantees a
// reminder can never be claimed twice, while a failed push is retried next run.
const sendFeeReminders = async () => {
  const now = new Date();
  const dueSoonLimit = new Date(now.getTime() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await FeeInvoice.find({
    status: { $in: ["Unpaid", "Partial", "Overdue"] },
    $expr: { $lt: [{ $ifNull: ["$paidAmount", 0] }, { $ifNull: ["$amount", 0] }] },
    $or: [
      // due within the next 3 days (including today's due date)
      { dueDate: { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), $lte: dueSoonLimit } },
      // past due
      { dueDate: { $lt: now } },
    ],
  })
    .select({ schoolId: 1, studentId: 1, feeType: 1, amount: 1, paidAmount: 1, dueDate: 1 })
    .limit(BATCH_LIMIT)
    .lean();

  let sent = 0;
  let skipped = 0;
  let released = 0;

  for (const invoice of candidates) {
    const kind = invoice.dueDate < now ? "overdue" : "due_soon";
    const outstanding = Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0));
    if (outstanding <= 0) continue;

    // Claim first — a 11000 here means this reminder was already sent.
    let claim;
    try {
      claim = await FeeReminder.create({
        schoolId: invoice.schoolId,
        invoiceId: invoice._id,
        studentId: invoice.studentId,
        channel: "inapp",
        kind,
      });
    } catch (err) {
      if (isDupKey(err)) skipped += 1;
      else console.error("[fee-reminders] claim failed:", err.message);
      continue;
    }

    const { refIds, emails } = await resolveRecipients(invoice.schoolId, invoice.studentId);
    if (refIds.length === 0) {
      // Nobody can receive it yet (no linked accounts) — keep the claim so we
      // do not re-churn, the student portal shows dues anyway.
      continue;
    }

    const dueLabel = new Date(invoice.dueDate).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const title = kind === "overdue" ? "Fee payment overdue" : "Fee payment due soon";
    const message =
      kind === "overdue"
        ? `${invoice.feeType || "Fee"} of Rs. ${outstanding.toLocaleString("en-IN")} was due on ${dueLabel}. Please pay at the earliest.`
        : `${invoice.feeType || "Fee"} of Rs. ${outstanding.toLocaleString("en-IN")} is due on ${dueLabel}.`;

    const result = await notifyByRefIds({
      schoolId: invoice.schoolId,
      refIds,
      kind: "fee_reminder",
      link: "/fees",
      title,
      message,
    });

    if (result) {
      sent += 1;
      await FeeReminder.updateOne({ _id: claim._id }, { $set: { recipientCount: refIds.length } });
      // Best-effort email (only when SMTP is configured) — a failed email must
      // not release the claim, the in-app reminder already went out.
      if (emails.length > 0) {
        await sendEmailViaAuth({
          to: emails,
          subject: `${title} — ${invoice.feeType || "Fee"}`,
          html: `<p>${message}</p><p>Please log in to the school portal to view and pay dues.</p>`,
        });
      }
    } else {
      // Push failed or channel unconfigured — release the claim so the next
      // run retries instead of the family silently never hearing from us.
      await FeeReminder.deleteOne({ _id: claim._id });
      released += 1;
    }
  }

  if (sent > 0 || released > 0) {
    console.log(`[fee-reminders] sent=${sent} already-sent=${skipped} released=${released}`);
  }
  return { sent, skipped, released, considered: candidates.length };
};

const startFeeReminderScheduler = () => {
  console.log(`[fee-reminders] Starting fee reminder scheduler (every ${REMINDER_INTERVAL_MS / 3600000}h)`);
  sendFeeReminders(); // run immediately on startup (idempotent via unique index)
  setInterval(sendFeeReminders, REMINDER_INTERVAL_MS);
};

module.exports = { startFeeReminderScheduler, sendFeeReminders, resolveRecipients };

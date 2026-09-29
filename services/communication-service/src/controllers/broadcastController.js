const MessageLog = require("../models/MessageLog");
const { getUserModel } = require("../models/userLite");
const { getStudentModel } = require("../db/studentDb");
const { getStaffModels } = require("../db/staffDb");
const {
  resolveAudienceUserIds,
  rosterAdmissionNos,
  classTagFilters,
  parseClassTag,
} = require("../services/audience");
const { sendEmailBulk } = require("../services/relayEmail");
const { sendSmsBulk, isEnabled } = require("../services/sms");

const MAX_BROADCAST = 500;

const logBroadcast = async ({
  schoolId,
  channel,
  subject,
  body,
  audience,
  recipients,
  result,
  createdBy,
}) => {
  const sent = result.sent || 0;
  const failed = result.failed || 0;
  const skipped = result.skipped || 0;
  const dryRun = Boolean(result.dryRun) || skipped > 0;
  let status = "sent";
  if (dryRun && sent === 0) status = "dry_run";
  else if (failed > 0 && sent > 0) status = "partial";
  else if (failed > 0 && sent === 0) status = "failed";
  return MessageLog.create({
    schoolId,
    channel,
    subject,
    body,
    audience,
    recipients,
    sent,
    failed,
    skipped,
    dryRun,
    status,
    createdBy,
  });
};

// ---- SMS recipient resolution ----
// numbers: explicit; studentIds/classTags/audience: parent contacts from the
// student mirror; staff/teacher audience: staff contacts from the staff mirror.
const resolveSmsNumbers = async ({ schoolId, numbers = [], studentIds = [], classTags = [], audience = [] }) => {
  const out = new Set(numbers.map((n) => String(n).replace(/[^\d+]/g, "")));
  const addParentContacts = async (admissionNos) => {
    if (admissionNos.length === 0) return;
    const Student = await getStudentModel();
    const students = await Student.find({ schoolId, admissionNo: { $in: admissionNos } })
      .select("parentContact")
      .lean();
    students.forEach((s) => {
      if (s.parentContact) out.add(String(s.parentContact).replace(/[^\d+]/g, ""));
    });
  };
  try {
    if (studentIds.length > 0) await addParentContacts(studentIds);
    const scoped = classTags.map((t) => String(t).trim()).filter(Boolean);
    if (scoped.length > 0) {
      const roster = await rosterAdmissionNos(schoolId, scoped);
      if (roster !== null) await addParentContacts(roster);
    }
    const roleSet = new Set(audience.flatMap((a) => (a === "all" ? ["student", "parent"] : a && a.constructor === Array ? a : [a])));
    const wantsAllStudents = roleSet.has("student");
    if (wantsAllStudents) {
      const Student = await getStudentModel();
      const students = await Student.find({ schoolId, status: "Active" }).select("parentContact").lean();
      students.forEach((s) => {
        if (s.parentContact) out.add(String(s.parentContact).replace(/[^\d+]/g, ""));
      });
    }
    if (roleSet.has("staff") || roleSet.has("teacher") || roleSet.has("school_admin")) {
      const { Staff } = await getStaffModels();
      const staff = await Staff.find({ schoolId, status: "Active" }).select("contact").lean();
      staff.forEach((s) => {
        if (s.contact) out.add(String(s.contact).replace(/[^\d+]/g, ""));
      });
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not configured")) throw err;
    console.error("[sms resolution partial]", err.message);
  }
  return [...out].filter((n) => n.replace(/\D/g, "").length >= 7);
};

// ---- Email recipient resolution ----
const resolveEmailTargets = async ({ schoolId, emails = [], studentIds = [], classTags = [], audience = [] }) => {
  const out = new Set(emails.map((e) => String(e).trim()).filter((e) => e.includes("@")));
  const User = getUserModel();
  const addByUserIds = async (userIds) => {
    if (userIds.length === 0) return;
    const users = await User.find({ _id: { $in: userIds } }).select("email").lean();
    users.forEach((u) => {
      if (u.email) out.add(String(u.email).trim());
    });
  };
  try {
    const normalized = (audience || []).flatMap((a) =>
      (a && a.constructor === Array) ? a : [a]
    );
    if (normalized.length > 0) {
      const userIds = await resolveAudienceUserIds({ schoolId, audience: normalized, classTags });
      await addByUserIds(userIds);
    }
    if (studentIds.length > 0) {
      const Student = await getStudentModel();
      const students = await Student.find({ schoolId, admissionNo: { $in: studentIds } })
        .select("parentEmail")
        .lean();
      students.forEach((s) => {
        if (s.parentEmail) out.add(String(s.parentEmail).trim());
      });
    }
  } catch (err) {
    console.error("[email resolution partial]", err.message);
  }
  return [...out];
};

// POST /sms
const sendSms = async (req, res) => {
  try {
    const { audience = [], studentIds = [], classTags = [], numbers = [], message = "" } = req.body;
    if (!String(message).trim()) {
      return res.status(400).json({ success: false, message: "message is required" });
    }
    const recipients = await resolveSmsNumbers({
      schoolId: req.tenantId,
      numbers,
      studentIds,
      classTags,
      audience,
    });
    if (recipients.length > MAX_BROADCAST) {
      return res.status(413).json({
        success: false,
        message: `Broadcast limited to ${MAX_BROADCAST} recipients (requested ${recipients.length})`,
      });
    }
    const result = await sendSmsBulk({ numbers: recipients, message: String(message).slice(0, 480) });
    const log = await logBroadcast({
      schoolId: req.tenantId,
      channel: "sms",
      subject: null,
      body: String(message).slice(0, 480),
      audience,
      recipients,
      result,
      createdBy: req.user.name,
    });
    res.json({
      success: true,
      message: result.dryRun ? "SMS provider is disabled — dry-run only" : "SMS broadcast queued",
      data: { recipients: recipients.length, ...result, logId: log._id },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /email
const sendEmail = async (req, res) => {
  try {
    const { audience = [], studentIds = [], classTags = [], emails = [], subject = "", html = "" } = req.body;
    if (!String(subject).trim() || !String(html).trim()) {
      return res.status(400).json({ success: false, message: "subject and html are required" });
    }
    const recipients = await resolveEmailTargets({
      schoolId: req.tenantId,
      emails,
      studentIds,
      classTags,
      audience,
    });
    if (recipients.length > MAX_BROADCAST) {
      return res.status(413).json({
        success: false,
        message: `Broadcast limited to ${MAX_BROADCAST} recipients (requested ${recipients.length})`,
      });
    }
    const result = await sendEmailBulk({
      to: recipients,
      subject: String(subject).slice(0, 200),
      html: String(html).slice(0, 10000),
    });
    const log = await logBroadcast({
      schoolId: req.tenantId,
      channel: "email",
      subject: String(subject).slice(0, 200),
      body: String(html).slice(0, 10000),
      audience,
      recipients,
      result,
      createdBy: req.user.name,
    });
    res.json({
      success: true,
      message: result.skipped > 0 ? "SMTP not configured — no emails sent" : "Email broadcast queued",
      data: { recipients: recipients.length, ...result, logId: log._id },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /logs — broadcast history (audit trail).
const listLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(50, Math.max(1, Number(limit) || 20));
    const filter = { schoolId: req.tenantId };
    if (req.query.channel) filter.channel = String(req.query.channel);
    const [data, total] = await Promise.all([
      MessageLog.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l),
      MessageLog.countDocuments(filter),
    ]);
    res.json({
      success: true,
      count: data.length,
      total,
      page: p,
      pages: Math.ceil(total / l),
      data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { sendSms, sendEmail, listLogs };
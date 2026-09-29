const Notice = require("../models/Notice");
const { getUserModel } = require("../models/userLite");
const { resolveAudienceUserIds, insertFanout, visibleClassTagsFor } = require("../services/audience");
const { sendEmailBulk } = require("../services/relayEmail");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Mass-assignment guard: only these fields may be set from the request body
// (schoolId / postedBy / timestamps stay server-owned).
const NOTICE_FIELDS = [
  "title", "description", "category", "pinned", "audience", "classTags", "priority", "attachments", "expiryDate",
];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// After a notice is published, fan out an inbox notification to the matching
// audience (role + classTags resolution lives in services/audience). Priority
// "emergency" bumps the notification kind so the client renders it as a
// priority alert. Failures are logged but never block notice creation.
// Emergency notices also fan out over email (when SMTP is configured) so the
// alert reaches parents/admins outside the app. Fire-and-forget non-blocking.
const emergencyEmailBlast = async ({ schoolId, title, description, audience, classTags }) => {
  try {
    const User = getUserModel();
    const userIds = await resolveAudienceUserIds({ schoolId, audience, classTags });
    if (userIds.length === 0) return;
    const users = await User.find({ _id: { $in: userIds } }).select("email").lean();
    const emails = [...new Set(users.map((u) => (u.email ? String(u.email).trim() : null)).filter(Boolean))];
    if (emails.length === 0) return;
    await sendEmailBulk({
      to: emails,
      subject: `EMERGENCY: ${title}`,
      html: `<h2 style="color:#b00020">EMERGENCY NOTICE</h2><p>${String(description || title)}</p>`,
    });
  } catch (err) {
    console.error("[emergency email blast skipped]", err.message);
  }
};

const fanOutNotice = async ({ schoolId, title, description, audience = [], classTags = [], priority = "normal" }) => {
  try {
    const kind = priority === "emergency" ? "emergency" : "notice";
    const userIds = await resolveAudienceUserIds({ schoolId, audience, classTags });
    await insertFanout(schoolId, userIds, {
      title: kind === "emergency" ? `EMERGENCY: ${title}` : "New Notice",
      message: title,
      kind,
      link: "/notice-board",
    });
    if (kind === "emergency") {
      emergencyEmailBlast({ schoolId, title, description, audience, classTags });
    }
  } catch (err) {
    console.error("[notice fanout skipped]", err.message);
  }
};

const createNotice = async (req, res) => {
  try {
    const notice = await Notice.create({ ...pick(req.body, NOTICE_FIELDS), schoolId: req.tenantId, postedBy: req.user.name });
    fanOutNotice({
      schoolId: req.tenantId,
      title: notice.title,
      description: notice.description,
      audience: notice.audience,
      classTags: notice.classTags || [],
      priority: notice.priority,
    });
    res.status(201).json({ success: true, data: notice });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getNotices = async (req, res) => {
  try {
    // "teacher" accounts are teaching staff: they see school-wide ("all")
    // notices as well as notices published for class_teacher audiences.
    const effectiveAudiences =
      req.user.role === "teacher"
        ? ["teacher", "class_teacher", "all"]
        : [req.user.role, "all"];
    const filter = { schoolId: req.tenantId, audience: { $in: effectiveAudiences } };
    // Class-tag scoping: only students/parents are restricted; staff and
    // teachers see tagged notices regardless (they may teach those classes).
    const ownTags = await visibleClassTagsFor({ tenantId: req.tenantId, user: req.user });
    if (ownTags !== null) {
      filter.$and = [
        {
          $or: [
            { classTags: { $exists: false } },
            { classTags: { $size: 0 } },
            { classTags: { $in: [...ownTags] } },
          ],
        },
      ];
    }
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      Notice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notice.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Tenant-scoped atomic update replacing the previous delete-then-recreate edit
// flow on the frontend (which could lose a notice if the recreate failed).
// Only notice-owned fields may be patched; schoolId / postedBy stay server-owned.
// Passed body keys are pick-guarded, so pin toggles can send { pinned } alone.
const updateNotice = async (req, res) => {
  try {
    const updates = pick(req.body, NOTICE_FIELDS);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }
    const before = await Notice.findOne({ _id: req.params.id, schoolId: req.tenantId }).lean();
    if (!before) return res.status(404).json({ success: false, message: "Notice not found" });
    const notice = await Notice.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { $set: updates },
      { new: true, runValidators: true },
    );
    // Escalation: raising a notice to emergency re-fans-out with the emergency
    // kind so everyone in the (possibly changed) audience gets the alert even
    // if they already read the original "normal" copy.
    if (before.priority !== "emergency" && notice.priority === "emergency") {
      fanOutNotice({
        schoolId: req.tenantId,
        title: notice.title,
        description: notice.description,
        audience: notice.audience,
        classTags: notice.classTags || [],
        priority: "emergency",
      });
    }
    res.json({ success: true, data: notice });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteNotice = async (req, res) => {
  try {
    const notice = await Notice.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!notice) return res.status(404).json({ success: false, message: "Notice not found" });
    res.json({ success: true, message: "Notice deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createNotice, getNotices, updateNotice, deleteNotice };

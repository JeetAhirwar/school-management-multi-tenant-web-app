const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { getUserModel } = require("../models/userLite");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { publish, subscribe } = require("../realtime/hub");

// Server-Sent Events stream for the caller's inbox. Heartbeats keep the
// connection alive through the gateway proxy, which has a short inactivity
// timeout (PROXY_TIMEOUT_MS). The client re-connects on `retry`.
const streamNotifications = (req, res) => {
  const isSuperAdmin = req.user?.role === "super_admin";
  if (!req.tenantId && !isSuperAdmin) {
    return res.status(400).json({ success: false, message: "No school context for this request" });
  }

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`retry: 3000\n\n`);

  const schoolId = req.tenantId || "platform";
  const userId = String(req.user.id);
  const unsubscribe = subscribe(schoolId, userId, (notification) => {
    res.write(`data: ${JSON.stringify(notification)}\n\n`);
  });

  // Gateway proxy timeout is 10s by default; a comment every 5s is pure idle
  // filler that keeps the socket alive without reaching the SSE parser.
  const heartbeat = setInterval(() => res.write(": hb\n\n"), 5000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
};

// Own inbox — always the caller's own notifications, tenant-scoped.
const getNotifications = async (req, res) => {
  try {
    const { unread } = req.query;
    const { page, limit, skip } = paginate(req.query, { fallback: 100, max: 500 });
    const isSuperAdmin = req.user?.role === "super_admin";
    const filter = { userId: String(req.user.id) };
    if (!isSuperAdmin) filter.schoolId = req.tenantId;
    if (unread === "true") filter.read = false;
    const [data, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
    ]);
    const unreadCount = await Notification.countDocuments({
      schoolId: req.tenantId,
      userId: String(req.user.id),
      read: false,
    });
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), unreadCount, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const isSuperAdmin = req.user?.role === "super_admin";
    const filter = {
      userId: String(req.user.id),
      read: false,
    };
    if (!isSuperAdmin) filter.schoolId = req.tenantId;
    if (req.query.kind) {
      filter.kind = req.query.kind;
    }
    const unreadCount = await Notification.countDocuments(filter);
    res.json({ success: true, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const isSuperAdmin = req.user?.role === "super_admin";
    const filter = { _id: req.params.id, userId: String(req.user.id) };
    if (!isSuperAdmin) filter.schoolId = req.tenantId;
    const record = await Notification.findOneAndUpdate(
      filter,
      { read: true },
      { new: true },
    );
    if (!record) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    const isSuperAdmin = req.user?.role === "super_admin";
    const filter = { userId: String(req.user.id), read: false };
    if (!isSuperAdmin) filter.schoolId = req.tenantId;
    await Notification.updateMany(
      filter,
      { read: true },
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Service-to-service push. Gated behind notices:publish so only privileged
// accounts (school_admin / super_admin) can create notifications for their
// own school's users. Authored by an authenticated admin action in another
// service (leave approval, payroll release, notice publish, ...).
const pushNotifications = async (req, res) => {
  try {
    const { userIds = [], title, message, kind = "system", link = null } = req.body;
    if (!title || userIds.length === 0) {
      return res.status(400).json({ success: false, message: "title and userIds are required" });
    }
    const docs = [...new Set(userIds.map((u) => String(u)))]
      .filter(Boolean)
      .map((userId) => ({
        schoolId: req.tenantId,
        userId,
        title: String(title).slice(0, 200),
        message: message ? String(message).slice(0, 500) : null,
        kind,
        link,
      }));
    const data = await Notification.insertMany(docs);
    data.forEach((n) => publish(req.tenantId, n.userId, n));
    res.status(201).json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// [INTERNAL] Service-to-service fanout by refId (e.g. a student's admissionNo
// or a staff id). Resolves refIds to active user ids in the shared auth DB and
// inserts inbox notifications. Only reachable with the internal key header.
const pushByRefIds = async (req, res) => {
  try {
    const { schoolId, refIds = [], title, message, kind = "system", link = null } = req.body;
    if (!schoolId || !title || refIds.length === 0) {
      return res.status(400).json({ success: false, message: "schoolId, title and refIds are required" });
    }
    if (!mongoose.isValidObjectId(String(schoolId))) {
      return res.status(400).json({ success: false, message: "Invalid schoolId" });
    }
    const User = getUserModel();
    // refIds are student admissionNos / staff refs. Parents have refId ===
    // null and are linked to their children via linkedStudentIds, so a plain
    // refId $in would never reach them — that single $or also delivers
    // fee_reminders, exam/report pushes and any other refId-based alert to a
    // child's parents.
    const users = await User.find(
      {
        schoolId,
        isActive: true,
        $or: [
          { refId: { $in: refIds.map((r) => String(r)) } },
          { role: "parent", linkedStudentIds: { $in: refIds.map((r) => String(r)) } },
        ],
      },
      { _id: 1 }
    ).lean();
    const userIds = [...new Set(users.map((u) => String(u._id)))];
    if (userIds.length === 0) {
      return res.json({ success: true, count: 0, data: [] });
    }
    const docs = userIds.map((userId) => ({
      schoolId,
      userId,
      title: String(title).slice(0, 200),
      message: message ? String(message).slice(0, 500) : null,
      kind,
      link,
    }));
    const data = await Notification.insertMany(docs);
    data.forEach((n) => publish(schoolId, n.userId, n));
    res.status(201).json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// [INTERNAL] Service-to-service fanout by roles. Pushes notifications to all
// active users in a school who have one of the specified roles. Optionally
// filter staff by designation (e.g. only admission_counsellor + receptionist).
const pushByRoles = async (req, res) => {
  try {
    const { schoolId, roles = [], designations = [], title, message, kind = "system", link = null } = req.body;
    if (!schoolId || !title || roles.length === 0) {
      return res.status(400).json({ success: false, message: "schoolId, title and roles are required" });
    }
    if (!mongoose.isValidObjectId(String(schoolId))) {
      return res.status(400).json({ success: false, message: "Invalid schoolId" });
    }
    const User = getUserModel();
    let users;
    if (roles.includes("staff") && designations.length > 0) {
      users = await User.find(
        {
          schoolId,
          isActive: true,
          $or: [
            { role: { $in: roles.filter((r) => r !== "staff") } },
            { role: "staff", designation: { $in: designations } },
          ],
        },
        { _id: 1 }
      ).lean();
    } else {
      users = await User.find(
        { schoolId, isActive: true, role: { $in: roles } },
        { _id: 1 }
      ).lean();
    }
    const userIds = [...new Set(users.map((u) => String(u._id)))];
    if (userIds.length === 0) {
      return res.json({ success: true, count: 0, data: [] });
    }
    const docs = userIds.map((userId) => ({
      schoolId,
      userId,
      title: String(title).slice(0, 200),
      message: message ? String(message).slice(0, 500) : null,
      kind,
      link,
    }));
    const data = await Notification.insertMany(docs);
    data.forEach((n) => publish(schoolId, n.userId, n));
    res.status(201).json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllRead, pushNotifications, pushByRefIds, pushByRoles, streamNotifications };
const Thread = require("../models/Thread");
const Notification = require("../models/Notification");
const { getUserModel } = require("../models/userLite");
const { getStudentModel } = require("../db/studentDb");
const { getStaffModels } = require("../db/staffDb");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { publish } = require("../realtime/hub");

const isStaffRole = (role) => role === "school_admin" || role === "super_admin";

// Current class teacher of an admissionNo, resolved through the staff DB
// (TeacherAssignment -> Staff.userId). Returns null when there is none.
const classTeacherUserId = async (schoolId, admissionNo) => {
  try {
    const Student = await getStudentModel();
    const student = await Student.findOne({ schoolId, admissionNo: String(admissionNo) })
      .select("class section")
      .lean();
    if (!student || !student.class || !student.section) return null;
    const { TeacherAssignment, Staff } = await getStaffModels();
    const assignment = await TeacherAssignment.findOne({
      schoolId,
      class: student.class,
      section: student.section,
      type: "class_teacher",
      status: "active",
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (!assignment) return null;
    const staff = await Staff.findById(assignment.staffId).select("userId").lean();
    return staff?.userId ? String(staff.userId) : null;
  } catch (err) {
    console.error("[class teacher lookup skipped]", err.message);
    return null;
  }
};

// Access rules for one student's thread(s): the student's parent, the class
// teacher of the student's class, or school staff. Returns false otherwise.
const canAccessStudent = async (req, studentId) => {
  const role = req.user.role;
  if (isStaffRole(role)) return true;
  if (role === "parent") {
    try {
      const User = getUserModel();
      const me = await User.findById(req.user.id).select("linkedStudentIds").lean();
      return (me?.linkedStudentIds || []).map(String).includes(String(studentId));
    } catch {
      return false;
    }
  }
  if (role === "teacher") {
    const teacherId = await classTeacherUserId(req.tenantId, studentId);
    return teacherId !== null && teacherId === String(req.user.id);
  }
  return false;
};

// Parents of ONE student (for notifying them of teacher replies).
const parentUserIds = async (schoolId, studentId) => {
  try {
    const User = getUserModel();
    const parents = await User.find({
      schoolId,
      isActive: true,
      role: "parent",
      linkedStudentIds: String(studentId),
    })
      .select("_id")
      .lean();
    return parents.map((p) => String(p._id));
  } catch (err) {
    console.error("[parent lookup skipped]", err.message);
    return [];
  }
};

const notify = async (schoolId, userIds, { title, message, link }) => {
  if (userIds.length === 0) return;
  try {
    const docs = userIds.map((userId) => ({
      schoolId,
      userId,
      title,
      message: message ? String(message).slice(0, 500) : null,
      kind: "message",
      link,
    }));
    const inserted = await Notification.insertMany(docs);
    inserted.forEach((n) => publish(schoolId, n.userId, n));
  } catch (err) {
    console.error("[thread fanout skipped]", err.message);
  }
};

const listThreads = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    if (req.query.studentId) filter.studentId = String(req.query.studentId);
    const role = req.user.role;
    if (role === "parent") {
      const User = getUserModel();
      const me = await User.findById(req.user.id).select("linkedStudentIds").lean();
      const ids = [...new Set((me?.linkedStudentIds || []).map(String).filter(Boolean))];
      filter.studentId = { $in: ids };
      if (ids.length === 0) {
        return res.json({ success: true, count: 0, total: 0, ...pageInfo(0, 1, 10), data: [] });
      }
    } else if (role === "teacher") {
      // Teachers only see threads for children of classes they class-teach.
      const { TeacherAssignment, Staff } = await getStaffModels();
      const mine = await TeacherAssignment.find({
        schoolId: req.tenantId,
        type: "class_teacher",
        status: "active",
        staffId: { $ne: null },
      })
        .select("staffId class section")
        .lean();
      const staffIds = [...new Set(mine.map((a) => String(a.staffId)))];
      const mineStaff = staffIds.length
        ? await Staff.find({ _id: { $in: staffIds }, userId: String(req.user.id) })
            .select("_id")
            .lean()
        : [];
      const staffSet = new Set(mineStaff.map((s) => String(s._id)));
      const myClasses = mine.filter((a) => staffSet.has(String(a.staffId)));
      if (myClasses.length === 0) {
        return res.json({ success: true, count: 0, total: 0, ...pageInfo(0, 1, 10), data: [] });
      }
      const Student = await getStudentModel();
      const roster = await Student.find({
        schoolId: req.tenantId,
        status: "Active",
        $or: myClasses.map((a) => ({ class: a.class, section: a.section })),
      })
        .select("admissionNo")
        .lean();
      const admissionNos = [...new Set(roster.map((s) => String(s.admissionNo)).filter(Boolean))];
      if (admissionNos.length === 0) {
        return res.json({ success: true, count: 0, total: 0, ...pageInfo(0, 1, 10), data: [] });
      }
      filter.studentId = { $in: admissionNos };
    }
    // staff roles: school-wide (no extra scoping)
    const { page, limit, skip } = paginate(req.query, { fallback: 20, max: 100 });
    const [data, total] = await Promise.all([
      Thread.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(limit),
      Thread.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createThread = async (req, res) => {
  try {
    const studentId = String(req.body.studentId || "").trim();
    const subject = String(req.body.subject || "").trim();
    const body = String(req.body.body || "").trim();
    if (!studentId || !subject || !body) {
      return res.status(400).json({ success: false, message: "studentId, subject and body are required" });
    }
    const allowed = await canAccessStudent(req, studentId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "You cannot message about this student" });
    }
    const thread = await Thread.create({
      schoolId: req.tenantId,
      studentId,
      subject,
      lastMessageAt: new Date(),
      messages: [
        {
          senderId: String(req.user.id),
          senderRole: req.user.role,
          senderName: req.user.name || "",
          body,
        },
      ],
    });
    // Notify the other side: parents -> class teacher; teacher/staff -> parents.
    if (req.user.role === "parent") {
      const teacherId = await classTeacherUserId(req.tenantId, studentId);
      if (teacherId) {
        notify(req.tenantId, [teacherId], { title: "New Message", message: subject, link: "/messages" });
      }
    } else {
      notify(req.tenantId, await parentUserIds(req.tenantId, studentId), {
        title: "New Message",
        message: subject,
        link: "/messages",
      });
    }
    res.status(201).json({ success: true, data: thread });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getThread = async (req, res) => {
  try {
    const thread = await Thread.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!thread) return res.status(404).json({ success: false, message: "Thread not found" });
    const allowed = await canAccessStudent(req, thread.studentId);
    if (!allowed) return res.status(403).json({ success: false, message: "Access denied" });
    res.json({ success: true, data: thread });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const replyToThread = async (req, res) => {
  try {
    const body = String(req.body.body || "").trim();
    if (!body) return res.status(400).json({ success: false, message: "body is required" });
    const thread = await Thread.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!thread) return res.status(404).json({ success: false, message: "Thread not found" });
    const allowed = await canAccessStudent(req, thread.studentId);
    if (!allowed) return res.status(403).json({ success: false, message: "Access denied" });
    thread.messages.push({
      senderId: String(req.user.id),
      senderRole: req.user.role,
      senderName: req.user.name || "",
      body,
    });
    thread.lastMessageAt = new Date();
    await thread.save();
    if (req.user.role === "parent") {
      const teacherId = await classTeacherUserId(req.tenantId, thread.studentId);
      if (teacherId) {
        notify(req.tenantId, [teacherId], { title: "New Message", message: thread.subject, link: "/messages" });
      }
    } else {
      notify(req.tenantId, await parentUserIds(req.tenantId, thread.studentId), {
        title: "New Message",
        message: thread.subject,
        link: "/messages",
      });
    }
    res.json({ success: true, data: thread });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { listThreads, createThread, getThread, replyToThread };

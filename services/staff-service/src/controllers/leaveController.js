const mongoose = require("mongoose");
const Leave = require("../models/Leave");
const Staff = require("../models/Staff");
const { pushNotifications, notifyByRefIds } = require("../utils/notify");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Annual leave entitlements per type
const LEAVE_ENTITLEMENTS = {
  Sick: 12,
  Casual: 12,
  Earned: 15,
  Maternity: 180,
  Other: 5,
};

// Mass-assignment guard: only these fields may be set from the request body.
// status / staffId / approvedBy are always server-controlled.
const LEAVE_FIELDS = ["leaveType", "fromDate", "toDate", "reason", "remarks"];

// Type perms: students may only apply for Sick / Casual / Other leave —
// Earned and Maternity are staff entitlements.
const STUDENT_LEAVE_TYPES = ["Sick", "Casual", "Other"];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const applyLeave = async (req, res) => {
  try {
    const isStudent = req.user.role === "student";
    // staffId is for Staff documents only. Student leaves go on studentId —
    // never write an admissionNo/refId into staffId (causes CastError later).
    const staffId = isStudent
      ? undefined
      : ["teacher", "staff"].includes(req.user.role)
        ? req.user.refId
        : req.body.staffId;
    const studentId = isStudent ? req.user.refId : undefined;
    const payload = pick(req.body, LEAVE_FIELDS);
    if (isStudent) {
      delete payload.remarks; // admin review note — never applicant-settable
      if (payload.leaveType !== undefined && !STUDENT_LEAVE_TYPES.includes(payload.leaveType)) {
        return res.status(400).json({
          success: false,
          message: "Students may only apply for Sick, Casual or Other leave",
        });
      }
    }
    const leave = await Leave.create({
      ...payload,
      staffId,
      studentId,
      schoolId: req.tenantId,
    });
    res.status(201).json({ success: true, data: leave });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getLeaves = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    if (["teacher", "staff"].includes(req.user.role)) {
      filter.staffId = req.user.refId;
    } else if (req.user.role === "student") {
      filter.studentId = req.user.refId;
    }
    if (req.query.status) filter.status = req.query.status;
    const { page, limit, skip } = paginate(req.query);
    const [leaves, total] = await Promise.all([
      Leave.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Leave.countDocuments(filter),
    ]);
    res.json({ success: true, count: leaves.length, total, ...pageInfo(total, page, limit), data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateLeaveStatus = async (req, res) => {
  try {
    const { status, remarks } = req.body;
    if (!["Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be Approved or Rejected" });
    }
    const leave = await Leave.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { status, remarks, approvedBy: req.user.name },
      { new: true },
    );
    if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });

    if (["Approved", "Rejected"].includes(status)) {
      // Staff leaves notify the Staff user; student leaves are keyed by
      // admissionNo (string) — never Staff.findById those.
      if (leave.studentId) {
        // studentId is the admissionNo, which is also the student's
        // User.refId — the internal push-by-refs channel resolves it to the
        // active student account inside this school (no admin JWT required;
        // the old guarded Student-model lookup never ran because that model
        // is not registered in staff-service).
        await notifyByRefIds({
          schoolId: req.tenantId,
          refIds: [leave.studentId],
          title: `Leave ${status}`,
          message: `Your ${leave.leaveType || "leave"} request (${leave.studentId}) was ${status.toLowerCase()}.`,
          kind: "leave",
          link: "/student/leave",
        });
      } else if (leave.staffId && mongoose.isValidObjectId(leave.staffId)) {
        const staff = await Staff.findById(leave.staffId).select("userId employeeId name").lean();
        if (staff?.userId) {
          pushNotifications({
            token: req.token,
            schoolId: req.tenantId,
            userIds: [staff.userId],
            title: `Leave ${status}`,
            message: `Your ${leave.leaveType || "leave"} request (${staff.employeeId || "—"}) was ${status.toLowerCase()}.`,
            kind: "leave",
            link: "/leave",
          });
        }
      }
    }
    return res.json({ success: true, data: leave });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

const getLeaveBalance = async (req, res) => {
  try {
    const staffId = req.user.role === "student" ? undefined : req.user.refId;
    const studentId = req.user.role === "student" ? req.user.refId : undefined;
    const targetId = staffId || studentId;
    if (!targetId) {
      return res.status(400).json({ success: false, message: "Unable to determine user" });
    }
    const currentYear = new Date().getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);
    const filter = {
      schoolId: req.tenantId,
      status: "Approved",
      fromDate: { $lte: yearEnd },
      toDate: { $gte: yearStart },
    };
    if (staffId) filter.staffId = staffId;
    if (studentId) filter.studentId = studentId;

    const approvedLeaves = await Leave.find(filter).lean();
    const balance = {};
    for (const [type, entitlement] of Object.entries(LEAVE_ENTITLEMENTS)) {
      const used = approvedLeaves.filter((l) => l.leaveType === type).reduce((sum, l) => {
        const from = new Date(l.fromDate);
        const to = new Date(l.toDate);
        const days = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
        return sum + Math.max(0, days);
      }, 0);
      balance[type] = { entitlement, used, remaining: Math.max(0, entitlement - used) };
    }
    res.json({ success: true, year: currentYear, data: balance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { applyLeave, getLeaves, updateLeaveStatus, getLeaveBalance };

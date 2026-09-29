const mongoose = require("mongoose");
const TeacherAssignment = require("../models/TeacherAssignment");
const Staff = require("../models/Staff");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { assertAcademicRefs } = require("@school-erp/shared/src/master-data");

const TYPES = ["teaching", "class_teacher"];
const AVAILABLE_STATUSES = ["active", "ended"];

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// Admin-only gate. Permissions already enforce `staff:write` at the route level;
// this is defense-in-depth so teachers can never self-assign or edit others.
const requireAdmin = (req, res) => {
  if (!["school_admin", "super_admin"].includes(req.user.role)) {
    return {
      ok: false,
      body: { success: false, message: "Only school admins can manage teacher assignments" },
    };
  }
  return { ok: true };
};

// Resolve the staff record that belongs to an authenticated non-admin user.
// Existing linkage is best-effort: Staff.userId (set by onboarding), staff email
// (matches the account email), or user.refId (Staff._id when populated).
const resolveStaffForUser = async (schoolId, user) => {
  if (!user) return null;
  if (user.refId && mongoose.isValidObjectId(user.refId)) {
    const byRef = await Staff.findOne({ _id: user.refId, schoolId }).lean();
    if (byRef) return byRef;
  }
  if (user.email) {
    const byEmail = await Staff.findOne({
      schoolId,
      email: String(user.email).toLowerCase(),
    }).lean();
    if (byEmail) return byEmail;
  }
  if (user.id) {
    const byUser = await Staff.findOne({ schoolId, userId: String(user.id) }).lean();
    return byUser || null;
  }
  return null;
};

const validatePayload = (body, { partial = false } = {}) => {
  const errors = [];
  const value = {};
  const check = (key, fn, label = key) => {
    if (body[key] !== undefined) {
      const out = fn(body[key]); // returns "" on success, an error message on failure
      if (out) errors.push(`${label}: ${out}`);
      else value[key] = body[key];
    } else if (!partial) {
      errors.push(`${label} is required`);
    }
  };

  check("session", (v) => {
    const s = String(v).trim();
    if (!s) return "must be a non-empty academic session (e.g. 2026-27)";
    if (s.length > 20) return "is too long";
    return "";
  });
  check("type", (v) => {
    if (!TYPES.includes(v)) return `must be one of: ${TYPES.join(", ")}`;
    return "";
  });
  check("class", (v) => {
    if (!String(v).trim()) return "is required";
    return "";
  });
  check("section", (v) => {
    if (!String(v).trim()) return "is required";
    return "";
  });

  if (body.type === "class_teacher") {
    value.subject = null;
  } else if (body.type === "teaching") {
    check("subject", (v) => {
      const s = String(v || "").trim();
      if (!s) return "is required for teaching assignments";
      return "";
    });
  } else if (!partial && body.type === undefined) {
    errors.push("type is required");
  }

  return { errors, value };
};

const conflictMessage = (type, session, cls, section) =>
  type === "class_teacher"
    ? `Class ${cls}-${section} already has an active Class Teacher for session ${session}`
    : `This teacher already has an active teaching assignment for Class ${cls}-${section}`;

// Check uniqueness of an active assignment, treating `excludeId` as the record
// being edited (it may already match and must be skipped).
const assertNoConflict = async ({ schoolId, staffId, session, type, subject, class: cls, section, excludeId }) => {
  const base = { schoolId, session, type, class: cls, section, status: "active" };
  if (excludeId) base._id = { $ne: excludeId };
  if (type === "teaching") base.subject = subject;

  const clash = await TeacherAssignment.findOne(base).select("_id").lean();
  if (clash) {
    const err = new Error(conflictMessage(type, session, cls, section));
    err.statusCode = 409;
    throw err;
  }
};

const createAssignment = async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin.ok) return res.status(403).json(admin.body);

    const { errors, value } = validatePayload(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join("; ") });
    }

    const staffId = req.body.staffId;
    if (!staffId || !mongoose.isValidObjectId(staffId)) {
      return res.status(400).json({ success: false, message: "staffId (a valid teacher id) is required" });
    }
    const staff = await Staff.findOne({ _id: staffId, schoolId: req.tenantId }).lean();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff member not found in this school" });
    }
    if (staff.role !== "teacher") {
      return res.status(400).json({
        success: false,
        message: `Only teaching staff can receive assignments (this record has role "${staff.role}")`,
      });
    }

    value.staffId = staffId;
    value.schoolId = req.tenantId;
    value.staffName = staff.name || "";

    await assertAcademicRefs({
      req,
      values: { class: value.class, section: value.section, subject: value.subject },
    });

    await assertNoConflict({ schoolId: req.tenantId, staffId, ...value });

    const doc = await TeacherAssignment.create(value);
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate active assignment" });
    }
    return res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

const listAssignments = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    const { staffId, session, type, status } = req.query;

    // Non-admins may only read their own assignments through this endpoint.
    if (!["school_admin", "super_admin"].includes(req.user.role)) {
      const own = await resolveStaffForUser(req.tenantId, req.user);
      if (!own) {
        return res.json({ success: true, count: 0, total: 0, data: [] });
      }
      filter.staffId = own._id;
    } else if (staffId && mongoose.isValidObjectId(staffId)) {
      filter.staffId = staffId;
    }
    if (session) filter.session = String(session);
    if (type) filter.type = type;
    if (status) filter.status = status;

    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      TeacherAssignment.find(filter)
        .sort({ session: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      TeacherAssignment.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const listMyAssignments = async (req, res) => {
  try {
    const staff = await resolveStaffForUser(req.tenantId, req.user);
    if (!staff) {
      return res.json({
        success: true,
        data: { staff: null, classTeacher: [], teaching: [], referrals: [] },
      });
    }
    const records = await TeacherAssignment.find({ schoolId: req.tenantId, staffId: staff._id })
      .sort({ createdAt: -1 })
      .lean();

    const activeTeaching = records.filter((r) => r.type === "teaching" && r.status === "active");
    const activeCT = records.filter((r) => r.type === "class_teacher" && r.status === "active");
    const history = records.filter((r) => r.status === "ended");

    // Derived convenience view: distinct (class, section) pairs & subjects the
    // teacher is currently assigned to teach, plus the homeroom scope.
    const teachingScopes = [];
    const seen = new Set();
    activeTeaching.forEach((r) => {
      const key = `${r.class}|${r.section}`;
      if (!seen.has(key)) {
        seen.add(key);
        teachingScopes.push({
          class: r.class,
          section: r.section,
          subjects: activeTeaching.filter((x) => x.class === r.class && x.section === r.section).map((x) => x.subject),
        });
      }
    });

    res.json({
      success: true,
      data: {
        staff: { id: staff._id, name: staff.name, designation: staff.designation, employeeId: staff.employeeId },
        classTeacher: activeCT,
        teaching: activeTeaching,
        teachingScopes,
        history,
        primaryScope: activeCT[0] || activeTeaching[0] || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAssignmentById = async (req, res) => {
  try {
    const doc = await TeacherAssignment.findOne({ _id: req.params.id, schoolId: req.tenantId }).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Assignment not found" });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateAssignment = async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin.ok) return res.status(403).json(admin.body);

    const doc = await TeacherAssignment.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!doc) return res.status(404).json({ success: false, message: "Assignment not found" });

    const editable = ["session", "type", "subject", "class", "section", "status", "staffId"];
    const changes = pick(req.body, editable);
    if (!Object.keys(changes).length) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    // Only allow re-opening an ended record; never delete history.
    if (changes.status === "active" && doc.status === "ended") changes.endedAt = null;
    if (changes.status === "ended" && doc.status !== "ended") changes.endedAt = new Date();

    // Re-validate the full resulting record (create rules also apply on edit).
    const { errors, value } = validatePayload({ ...doc.toObject(), ...changes }, { partial: false });
    if (errors.length) return res.status(400).json({ success: false, message: errors.join("; ") });

    let staffId = doc.staffId;
    if (changes.staffId && mongoose.isValidObjectId(changes.staffId)) {
      const staff = await Staff.findOne({ _id: changes.staffId, schoolId: req.tenantId }).lean();
      if (!staff) return res.status(404).json({ success: false, message: "Staff member not found in this school" });
      if (staff.role !== "teacher") {
        return res.status(400).json({ success: false, message: "Only teaching staff can receive assignments" });
      }
      staffId = changes.staffId;
      value.staffName = staff.name || "";
    }

    const next = {
      session: value.session || doc.session,
      type: value.type || doc.type,
      subject: value.subject !== undefined ? value.subject : doc.subject,
      class: value.class || doc.class,
      section: value.section || doc.section,
      status: changes.status || doc.status,
      staffId,
      staffName: value.staffName || doc.staffName,
    };

    const id = doc._id;
    if (next.status === "active") {
      // Validate only the fields being changed; a legacy stored value that is
      // not part of this edit is left untouched and never re-checked.
      const refValues = {};
      if (changes.class !== undefined) refValues.class = next.class;
      if (changes.section !== undefined) refValues.section = next.section;
      if (changes.subject !== undefined) refValues.subject = next.subject;
      await assertAcademicRefs({ req, values: refValues });
      await assertNoConflict({
        schoolId: req.tenantId,
        staffId: next.staffId,
        session: next.session,
        type: next.type,
        subject: next.subject,
        class: next.class,
        section: next.section,
        excludeId: id,
      });
    }

    const updated = await TeacherAssignment.findOneAndUpdate(
      { _id: id, schoolId: req.tenantId },
      { $set: { ...next, endedAt: changes.status === "active" ? null : doc.endedAt ?? (changes.status === "ended" ? changes.endedAt : null) } },
      { new: true, runValidators: true },
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate active assignment" });
    }
    return res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

// Soft-end only. The record (and its history) is preserved; a clean "ended"
// state feeds dashboards and audit trails for past sessions.
const endAssignment = async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin.ok) return res.status(403).json(admin.body);

    const doc = await TeacherAssignment.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId, status: "active" },
      { $set: { status: "ended", endedAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!doc) {
      const existing = await TeacherAssignment.findOne({ _id: req.params.id, schoolId: req.tenantId }).lean();
      if (!existing) return res.status(404).json({ success: false, message: "Assignment not found" });
      return res.status(400).json({ success: false, message: "Assignment is already ended" });
    }
    res.json({ success: true, data: doc, message: "Assignment ended; history preserved" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const startAssignment = async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin.ok) return res.status(403).json(admin.body);

    const doc = await TeacherAssignment.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!doc) return res.status(404).json({ success: false, message: "Assignment not found" });
    if (doc.status === "active") {
      return res.status(400).json({ success: false, message: "Assignment is already active" });
    }
    if (doc.type === "class_teacher") {
      await assertNoConflict({
        schoolId: req.tenantId,
        staffId: doc.staffId,
        session: doc.session,
        type: doc.type,
        subject: null,
        class: doc.class,
        section: doc.section,
        excludeId: doc._id,
      });
    }
    const updated = await TeacherAssignment.findOneAndUpdate(
      { _id: doc._id },
      { $set: { status: "active", endedAt: null } },
      { new: true },
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate active assignment" });
    }
    return res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

module.exports = {
  requireAdmin,
  createAssignment,
  listAssignments,
  listMyAssignments,
  getAssignmentById,
  updateAssignment,
  endAssignment,
  startAssignment,
};
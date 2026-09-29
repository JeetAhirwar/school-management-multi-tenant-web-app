const mongoose = require("mongoose");
const Student = require("../models/Student");
const { notifyByRefIds } = require("../utils/notify");
const { deactivateStudentUser } = require("../utils/authCascade");
const { assertAcademicRefs } = require("@school-erp/shared/src/master-data");
const { resolveTeacherScope } = require("@school-erp/shared/src/utils/teacherScope");
const { assertAllowedUpload } = require("@school-erp/shared/src/utils/uploads");

// Teacher access to a single student record is assignment-driven: the student's
// class + section must be inside the teacher's active assignment union,
// otherwise 403. Non-teachers are unaffected.
const assertTeacherStudentAccess = async (req, student) => {
  if (!student || req.user.role !== "teacher") return null;
  const tscope = await resolveTeacherScope({ tenantId: req.tenantId, user: req.user });
  if (!tscope || tscope.allScopes.length === 0 || !tscope.has(student.class, student.section)) {
    return { status: 403, message: "You can only access students in your assigned classes and sections" };
  }
  return null;
};

// Neutralizes regex metacharacters in user-supplied search terms so they cannot
// inject regex operators ($regex pattern injection) or craft catastrophic
// (ReDoS) patterns. Input is also length-capped to bound scan cost.
const escapeRegex = (term) =>
  String(term).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Mass-assignment guard for profile/record edits: only these fields may be set
// from the request body. Everything else (schoolId, userId, _id, timestamps,
// profileStatus/profileCompletedAt) is derived server-side.
const STUDENT_EDITABLE = [
  "name", "dob", "gender", "class", "section", "rollNo", "bloodGroup",
  "address", "photoUrl", "parentName", "parentContact", "parentEmail",
  "motherName", "house", "medium", "admissionDate", "feeCategory", "status", "admissionNo",
];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const imagekit = require("@school-erp/shared/src/config/imagekit");

// Fields that must be filled before a profile is considered complete. This is
// the ONE completion rule used everywhere (create, update, complete-profile)
// and mirrors the frontend StudentCompleteProfile gate: class + section +
// dob/gender/address + parent + mother fields.
const PROFILE_REQUIRED_FIELDS = [
  "class",
  "section",
  "dob",
  "gender",
  "address",
  "parentName",
  "parentContact",
  "motherName",
];

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === "";

const PHONE_RE = /^[+]?[0-9\s-]{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const computeProfileStatus = (doc) =>
  isEmpty(doc) || PROFILE_REQUIRED_FIELDS.some((f) => isEmpty(doc[f]))
    ? "incomplete"
    : "complete";

const isDuplicateKey = (err) =>
  err && (err.code === 11000 || (err.name === "MongoServerError" && err.code === 11000));

const uploadStudentPhoto = async (req, res) => {
  try {
if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "Photo file is required" });
    const uploadErr = assertAllowedUpload(req.file);
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr });
    }
    const imagekit = require("@school-erp/shared/src/config/imagekit");
    if (!imagekit) {
      return res
        .status(503)
        .json({ success: false, message: "Image provider is not configured" });
    }
    const uploaded = await imagekit.upload({
      file: req.file.buffer.toString("base64"),
      fileName: `student-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-")}`,
      folder: "/school-erp/students",
      useUniqueFileName: true,
      transformation: { pre: "q-80,w-800,h-800,fo-auto" },
    });
    res
      .status(201)
      .json({
        success: true,
        data: { url: uploaded.url, fileId: uploaded.fileId },
      });
  } catch (err) {
    res.status(502).json({ success: false, message: err?.message || "Image upload failed" });
  }
};

const createStudent = async (req, res) => {
  try {
    const {
      admissionNo,
      fatherName,
      motherName,
      phone,
      email,
      ...studentData
    } = req.body;

    const admissionId = String(admissionNo || "").trim();
    if (!admissionId) {
      return res.status(400).json({
        success: false,
        message: "Admission ID (admissionNo) is required for a student record",
      });
    }

    const existing = await Student.findOne({
      schoolId: req.tenantId,
      admissionNo: admissionId,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Admission ID "${admissionId}" already exists in this school`,
      });
    }

    const studentName = String(studentData.name || "").trim();
    if (!studentName) {
      return res.status(400).json({ success: false, message: "Student name is required" });
    }
    if (email !== undefined && String(email).trim() !== "" && !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    if (phone !== undefined && String(phone).trim() !== "" && !PHONE_RE.test(String(phone).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid phone number" });
    }

    const data = {
      ...pick(studentData, STUDENT_EDITABLE),
      schoolId: req.tenantId,
      admissionNo: admissionId,
      parentName: studentData.parentName || fatherName,
      parentContact: studentData.parentContact || phone,
      parentEmail: studentData.parentEmail || email,
      motherName: studentData.motherName || motherName,
    };
    data.profileStatus = computeProfileStatus(data);
    if (data.profileStatus === "complete") data.profileCompletedAt = new Date();

    await assertAcademicRefs({ req, values: { class: data.class, section: data.section } });

    const student = await Student.create(data);
    notifyByRefIds({
      schoolId: req.tenantId,
      refIds: [admissionId],
      title: "Admission record created",
      message: `Your student profile (${admissionId}) was created by the school admin.`,
      kind: "student",
      link: "/students",
    });
    res.status(201).json({ success: true, data: student });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return res.status(409).json({
        success: false,
        message: "This Admission ID already exists in this school",
      });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getStudents = async (req, res) => {
  try {
    const {
      class: cls,
      section,
      status,
      profileStatus,
      admissionNo,
      search,
      q,
      linked,
      includeDeleted,
      page = 1,
      limit = 20,
    } = req.query;
    const filter = { schoolId: req.tenantId };
    // Soft-deleted students are hidden from every listing unless explicitly
    // requested (admin "deleted" views / restore flows).
    if (includeDeleted !== "true" && includeDeleted !== "1") filter.deletedAt = null;
    if (req.user.role === "student") filter.admissionNo = req.user.refId;
    if (req.user.role === "parent")
      filter.admissionNo = { $in: req.user.linkedStudentIds || [] };
    if (cls) filter.class = cls;
    if (section) filter.section = section;
    if (status) filter.status = status;
    if (profileStatus) filter.profileStatus = profileStatus;
    if (admissionNo) {
      const adv = String(admissionNo).trim();
      // Role-scoped listings (student / parent) must never be narrowed to a
      // record outside their scope: a foreign admissionNo fails closed to an
      // empty page instead of overwriting the $in/$eq identity filter.
      if (req.user.role === "student" && String(req.user.refId || "") !== adv) {
        return res.json({
          success: true,
          count: 0,
          total: 0,
          page: Number(page),
          pages: 0,
          data: [],
        });
      }
      if (
        req.user.role === "parent" &&
        !(req.user.linkedStudentIds || []).map(String).includes(adv)
      ) {
        return res.json({
          success: true,
          count: 0,
          total: 0,
          page: Number(page),
          pages: 0,
          data: [],
        });
      }
      filter.admissionNo = adv;
    }
    if (linked === "true" || linked === "1")
      filter.userId = { $exists: true, $ne: null };
    const term = escapeRegex(String(q || search || "").trim());
    if (term) {
      const rx = { $regex: term, $options: "i" };
      filter.$or = [{ name: rx }, { admissionNo: rx }];
    }
    const students = await Student.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Student.countDocuments(filter);
    res.json({
      success: true,
      count: students.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: students,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------------------------------------
// Pending student registrations: Student shells (userId null) awaiting a
// Platform User account, produced by every confirmed admission. User-facing
// queue for admin/super — a school admin sees only their own school; a
// super_admin sees the school selected via X-School-Id (resolveTenant).
// ---------------------------------------------------------------------------
const getPendingRegistrations = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const filter = {
      schoolId: req.tenantId,
      // { userId: null } matches both explicit null and absent field, exactly
      // the union of shells (created on admission-confirm) that await a user.
      userId: null,
      deletedAt: null,
    };
    const students = await Student.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select(
        "name admissionNo class section profileStatus status createdAt",
      );
    const total = await Student.countDocuments(filter);
    res.json({
      success: true,
      count: students.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: students,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// "Current student" for the logged-in student account — resolves schoolId +
// refId (Admission ID) exactly like every other student-scoped request.
const getMyStudent = async (req, res) => {
  try {
    if (!["student", "parent"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only a student account can request its own profile",
      });
    }
    if (!req.user.refId) {
      return res.status(404).json({
        success: false,
        message: "No Admission ID linked to this account",
      });
    }
    const student = await Student.findOne({
      schoolId: req.tenantId,
      admissionNo: req.user.refId,
    });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: "No student profile found. Contact your Admission Counsellor.",
      });
    }
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Aggregate KPI surface for the Admission Counsellor workspace.
const counsellorStats = async (req, res) => {
  try {
    const base = { schoolId: req.tenantId, deletedAt: null };
    if (req.teacherScope) {
      base.class = req.teacherScope.class;
      if (req.teacherScope.section) base.section = req.teacherScope.section;
    }
    const [total, incomplete, complete] = await Promise.all([
      Student.countDocuments(base),
      Student.countDocuments({ ...base, profileStatus: "incomplete" }),
      Student.countDocuments({ ...base, profileStatus: "complete" }),
    ]);
    const recent = await Student.find(base)
      .sort({ createdAt: -1 })
      .limit(8)
      .select(
        "name admissionNo class section status profileStatus createdAt",
      );
    res.json({ success: true, data: { total, incomplete, complete, recent } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getStudentById = async (req, res) => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    const denied = await assertTeacherStudentAccess(req, student);
    if (denied) return res.status(denied.status).json({ success: false, message: denied.message });
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateStudent = async (req, res) => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    const denied = await assertTeacherStudentAccess(req, student);
    if (denied) return res.status(denied.status).json({ success: false, message: denied.message });
    if (student.deletedAt) {
      return res.status(409).json({ success: false, message: "Student is deleted — restore it first" });
    }

    const patch = pick(req.body, STUDENT_EDITABLE);
    delete patch.schoolId;
    if (patch.admissionNo !== undefined) {
      patch.admissionNo = String(patch.admissionNo).trim();
      if (!patch.admissionNo) {
        return res
          .status(400)
          .json({ success: false, message: "Admission ID cannot be empty" });
      }
    }
    if (patch.name !== undefined && isEmpty(patch.name)) {
      return res.status(400).json({ success: false, message: "Student name cannot be empty" });
    }
    if (patch.parentEmail !== undefined && String(patch.parentEmail).trim() !== "" && !EMAIL_RE.test(String(patch.parentEmail).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid parent email address" });
    }
    if (patch.parentContact !== undefined && String(patch.parentContact).trim() !== "" && !PHONE_RE.test(String(patch.parentContact).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid parent phone number" });
    }

    student.set(patch);
    student.profileStatus = computeProfileStatus(student);
    student.profileCompletedAt =
      student.profileStatus === "complete" ? (student.profileCompletedAt || new Date()) : null;

    // Validate only the fields actually being changed so legacy stored values
    // (kept in the record untouched) are never re-checked against the masters.
    const refValues = {};
    if (patch.class !== undefined) refValues.class = patch.class;
    if (patch.section !== undefined) refValues.section = patch.section;
    await assertAcademicRefs({ req, values: refValues });

    await student.save();

    notifyByRefIds({
      schoolId: req.tenantId,
      refIds: [student.admissionNo],
      title: "Profile updated",
      message: `Your student profile was updated by the school admin.`,
      kind: "student",
      link: "/students",
    });

    res.json({ success: true, data: student });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return res.status(409).json({
        success: false,
        message: "This Admission ID already exists in this school",
      });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

// Manual completion gate: validates required fields then marks the profile
// complete. Secured by students:write at the route level.
const completeProfile = async (req, res) => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    const denied = await assertTeacherStudentAccess(req, student);
    if (denied) return res.status(denied.status).json({ success: false, message: denied.message });
    if (student.deletedAt) {
      return res.status(409).json({ success: false, message: "Student is deleted — restore it first" });
    }

    const missing = PROFILE_REQUIRED_FIELDS.filter((f) => isEmpty(student[f]));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Profile incomplete. Missing: ${missing
          .map((f) => f.replace(/([A-Z])/g, " $1").toLowerCase())
          .join(", ")}`,
      });
    }

    student.profileStatus = "complete";
    student.profileCompletedAt = new Date();
    await student.save();
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// School admin issues a physical/printable ID card for an onboarded student.
// Only allowed once the student's profile is complete; re-issuing a reprint keeps
// the original idCardNumber but refreshes the issuedAt timestamp.
const issueIdCard = async (req, res) => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    const denied = await assertTeacherStudentAccess(req, student);
    if (denied) return res.status(denied.status).json({ success: false, message: denied.message });
    if (student.deletedAt) {
      return res.status(409).json({ success: false, message: "Student is deleted — restore it first" });
    }

    if (student.profileStatus !== "complete") {
      return res.status(400).json({
        success: false,
        message: "Student onboarding is not complete — ID card can only be issued after onboarding.",
      });
    }

    const year = String(new Date().getFullYear());
    if (!student.idCardNumber) {
      const seq = String(student.admissionNo || student._id).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      student.idCardNumber = `${seq ? `${seq}-` : ""}${year}-${String(student._id).slice(-4).toUpperCase()}`;
    }
    student.idCardIssuedAt = new Date();
    await student.save();
    notifyByRefIds({
      schoolId: req.tenantId,
      refIds: [student.admissionNo],
      title: "ID card ready",
      message: `Your ID card (${student.idCardNumber}) has been issued.`,
      kind: "profile",
      link: "/students",
    });
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteStudent = async (req, res) => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    if (student.deletedAt) {
      return res
        .status(409)
        .json({ success: false, message: "Student is already deleted" });
    }
    const denied = await assertTeacherStudentAccess(req, student);
    if (denied) return res.status(denied.status).json({ success: false, message: denied.message });
    // Soft-delete: the row (and its fee/attendance/library references in other
    // services) stays intact; lists/stats exclude it, and the purge job
    // hard-deletes it plus owned health/document data after retention.
    student.deletedAt = new Date();
    await student.save();
    // Cascade: deactivate the linked login so the account stops working.
    // Non-fatal — auth-service being down must not fail the delete.
    deactivateStudentUser({ schoolId: req.tenantId, admissionNo: student.admissionNo });
    res.json({ success: true, message: "Student deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Undo a soft-delete within the retention window (the purge job is the point
// of no return). Mirrors auth-service's user restore pattern.
const restoreStudent = async (req, res) => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    if (!student.deletedAt) {
      return res
        .status(409)
        .json({ success: false, message: "Student is not deleted" });
    }
    // The admissionNo may have been re-issued to a new student (partial unique
    // index allows it) — refuse the restore rather than create a duplicate.
    const clash = await Student.findOne({
      schoolId: req.tenantId,
      admissionNo: student.admissionNo,
      deletedAt: null,
      _id: { $ne: student._id },
    });
    if (clash) {
      return res.status(409).json({
        success: false,
        message: `Cannot restore: Admission ID "${student.admissionNo}" now belongs to another active student`,
      });
    }
    student.deletedAt = null;
    await student.save();
    res.json({ success: true, message: "Student restored", data: student });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return res.status(409).json({
        success: false,
        message: "Cannot restore: this Admission ID now belongs to another active student",
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

const bulkStats = async (req, res) => {
  try {
    const base = { schoolId: req.tenantId, deletedAt: null };
    if (req.teacherScope) {
      base.class = req.teacherScope.class;
      if (req.teacherScope.section) base.section = req.teacherScope.section;
    }
    const total = await Student.countDocuments(base);
    // aggregate does not auto-cast $match values, so cast _id fields explicitly.
    const pipeline = [
      { $match: { ...base, schoolId: new mongoose.Types.ObjectId(base.schoolId) } },
      { $group: { _id: "$class", count: { $sum: 1 } } },
    ];
    const byClass = await Student.aggregate(pipeline);
    const active = await Student.countDocuments({
      ...base,
      status: "Active",
    });
    res.json({ success: true, data: { total, active, byClass } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  uploadStudentPhoto,
  createStudent,
  getStudents,
  getPendingRegistrations,
  getStudentById,
  getMyStudent,
  counsellorStats,
  updateStudent,
  completeProfile,
  issueIdCard,
  deleteStudent,
  restoreStudent,
  bulkStats,
};

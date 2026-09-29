const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const School = require("../models/School");
const OtpToken = require("../models/OtpToken");
const PaymentGateway = require("../models/PaymentGateway");
const { validatePassword } = require("../utils/password");
const { sendEmail } = require("../utils/email");
const { getPermissionsFor } = require("@school-erp/shared/src/utils/permissions");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");
const { assertAllowedUpload } = require("@school-erp/shared/src/utils/uploads");
const { getJwtSecret } = require("@school-erp/shared/src/utils/jwtSecret");
const { writeAudit } = require("../utils/audit");
const { resolveCurrentSessionInfo, deriveSessionName } = require("./academicSessionController");

const VALID_ROLES = ["super_admin", "school_admin", "teacher", "staff", "student", "parent"];
// School admins create tenant-level accounts. "class_teacher" is not creatable:
// a Class Teacher is a TeacherAssignment responsibility, assigned by the school
// admin through the assignment-manager, not a User role.
const SCHOOL_ADMIN_CREATABLE = ["teacher", "staff", "student", "parent"];

// Failure responses never dump raw error/debug text (stack traces, DB paths,
// index/duplicate details) to the client. Details go to the server log only.
const unexpectedError = (res, err) => {
  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate entry violates a unique constraint" });
  }
  console.error("[auth] unexpected error:", err?.stack || err.message);
  return res.status(500).json({ success: false, message: "Something went wrong" });
};

// School fields a caller may update directly. Tenant identity (code) is
// immutable after creation; anything else is ignored → no mass assignment.
const SCHOOL_EDITABLE_FIELDS = [
  "name",
  "shortName",
  "address",
  "city",
  "state",
  "pincode",
  "phone",
  "email",
  "logo",
  "website",
  "domain",
  "plan",
  "status",
  "board",
  "recognitionNumber",
  "recognitionAuthority",
  "recognitionVerified",
  "recognitionVerifiedAt",
];

// Student-role linking: enforce `PlatformUser.refId === Student.admissionNo`
// within the SAME school. The Student shell is created ONLY when an admission
// is confirmed (student-service, admission flow) — Register User must never
// fabricate a student record. This step attaches the freshly created user to
// the shell it resolves to, or fails with a clear status when the shell does
// not exist / is already owned by another active account (which rolls the
// account back).
const ensureStudentLink = async ({ schoolId, admissionId, userId }) => {
  try {
    const { getStudentModel } = require("../db/studentDb");
    const Student = await getStudentModel();

    const existing = await Student.findOne({ schoolId, admissionNo: admissionId, deletedAt: null });
    if (!existing) {
      return {
        status: 400,
        message: "No pending student profile exists for this Admission ID in this school — confirm the admission first",
      };
    }
    if (existing.userId) {
      const linked = await User.findById(existing.userId).lean();
      if (linked && !linked.deletedAt && String(linked._id) !== String(userId)) {
        return { status: 409, message: "This Admission ID is already linked to another active account" };
      }
    }
    await Student.updateOne({ _id: existing._id }, { $set: { userId: String(userId) } });
    return { linked: existing._id };
  } catch (err) {
    return { status: 503, message: `Cannot link student profile: ${err.message}` };
  }
};

// True when the given Admission ID already maps to a student record in this
// school. Non-fatal on infrastructure failure so it only ever *prevents* an
// unsafe assignment, never blocks legitimate school operations.
const studentExistsFor = async (schoolId, admissionNo) => {
  try {
    const { getStudentModel } = require("../db/studentDb");
    const Student = await getStudentModel();
    return Boolean(
      await Student.findOne({ schoolId, admissionNo, deletedAt: null })
        .select("_id")
        .lean(),
    );
  } catch {
    return null;
  }
};

// Parent → child links (CLIENT-REQ-052): linkedStudentIds are admissionNo
// strings of EXISTING active students in the SAME school. Returns a cleaned,
// de-duplicated array or an error message.
const cleanAndValidateLinkedStudents = async (schoolId, linkedStudentIds) => {
  if (!Array.isArray(linkedStudentIds)) {
    return { error: "linkedStudentIds must be an array of Admission IDs" };
  }
  const ids = [...new Set(linkedStudentIds.map((s) => String(s || "").trim()).filter(Boolean))];
  for (const id of ids) {
    if (!(await studentExistsFor(schoolId, id))) {
      return { error: `No active student with Admission ID "${id}" in this school` };
    }
  }
  return { ids };
};

// ---------------------------------------------------------------------------
// Teacher/Staff linking — the shared "Register User" flow for person records.
// A person record must ALREADY exist (created from the Teachers & Staff page,
// manual Staff ID); Register User only links to it, it NEVER fabricates one.
// The stored user.refId is the linked Staff._id (keeps every staff-scoped
// lookup in the fleet — attendance, leaves, teacher assignments, /me —
// consistent), while the submitted Staff ID (employeeId) is the discovery key.
// ---------------------------------------------------------------------------
const STAFF_LINK_ROLES = ["teacher", "staff"];
const STAFF_LINK_OK = {
  teacher: ["teacher"],
  staff: ["admin-staff", "support"],
};

const staffLinkRequired = (role) => STAFF_LINK_ROLES.includes(role);

const staffRecordFor = async (schoolId, employeeId) => {
  try {
    const { getStaffModel } = require("../db/staffDb");
    const Staff = await getStaffModel();
    const record = await Staff.findOne({ schoolId, employeeId }).lean();
    if (!record) {
      console.error(`[staffRecordFor] No record found — schoolId=${schoolId} employeeId=${employeeId}`);
    }
    return record;
  } catch (err) {
    console.error("[staffRecordFor] DB error:", err.message);
    return null;
  }
};

const NO_PENDING_STAFF_MSG =
  "No pending Teacher/Staff record exists for this Staff ID in this school — create the record in Teachers & Staff first";

const ensureStaffLink = async ({ schoolId, employeeId, userRole, userId }) => {
  try {
    const { getStaffModel } = require("../db/staffDb");
    const Staff = await getStaffModel();

    const existing = await Staff.findOne({ schoolId, employeeId });
    if (!existing) return { status: 400, message: NO_PENDING_STAFF_MSG };
    if (!STAFF_LINK_OK[userRole].includes(existing.role)) {
      return {
        status: 400,
        message: `This Staff ID belongs to a ${existing.role} record — it cannot be linked to a ${userRole} account`,
      };
    }
    if (existing.userId) {
      const linked = await User.findById(existing.userId).lean();
      if (linked && !linked.deletedAt && String(linked._id) !== String(userId)) {
        return { status: 409, message: "This Staff ID is already linked to another active account" };
      }
    }
    await Staff.updateOne({ _id: existing._id }, { $set: { userId: String(userId) } });
    return { linked: existing._id };
  } catch (err) {
    return { status: 503, message: `Cannot link staff profile: ${err.message}` };
  }
};

const toPublicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  schoolId: user.schoolId || null,
  designation: user.designation || null,
  class: user.class || null,
  section: user.section || null,
  phone: user.phone || null,
  avatar: user.avatar || null,
  refId: user.refId || null,
  linkedStudentIds: user.linkedStudentIds || [],
  isActive: user.isActive !== false,
  emailVerified: user.emailVerified !== false,
  deletedAt: user.deletedAt || null,
  lastLogin: user.lastLogin || null,
  lastActivity: user.lastActivity || null,
  createdAt: user.createdAt || null,
  permissions: user.deletedAt ? [] : getPermissionsFor(user),
});

// Admin-only user creation (no public self-register). Enforces privilege
// hierarchy so a school admin can never create admins or touch other schools.
const createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone, refId, linkedStudentIds = [], designation, section } = req.body;
    const cls = req.body.class;
    const creator = req.user;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: "name, email, password and role are required" });
    }
    if (!EMAIL_RE.test(String(email || "").trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    if (phone !== undefined && String(phone).trim() !== "" && !PHONE_RE.test(String(phone).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid phone number" });
    }
    const passErr = validatePassword(password);
    if (passErr) return res.status(400).json({ success: false, message: passErr });
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${VALID_ROLES.join(", ")}` });
    }

    let schoolId;
    if (creator.role === "super_admin") {
      schoolId = role === "super_admin" ? null : req.body.schoolId || req.header("X-School-Id") || null;
      if (!schoolId && role !== "super_admin") {
        return res.status(400).json({ success: false, message: "schoolId is required for school-scoped roles" });
      }
    } else {
      if (!SCHOOL_ADMIN_CREATABLE.includes(role)) {
        return res.status(403).json({ success: false, message: "School admin cannot create this role" });
      }
      schoolId = creator.schoolId;
      if (!schoolId) {
        return res.status(403).json({ success: false, message: "School admin must belong to a school" });
      }
    }

    if (role === "staff" && !designation) {
      return res.status(400).json({ success: false, message: "designation is required for staff role" });
    }
    // A teacher account's class/section is an optional PRIMARY teaching scope.
    // Full multi-class scope lives in TeacherAssignment records
    // (type="teaching" | "class_teacher").

    const admissionId = role === "student" ? String(refId || "").trim() : null;
    if (role === "student" && !admissionId) {
      return res.status(400).json({ success: false, message: "Admission ID (refId) is required for student accounts" });
    }

    // An Admission Counsellor's own refId (Staff ID) must NEVER collide with a
    // student's Admission ID — otherwise their lookup logic could address
    // someone else's profile.
    if (
      role === "staff" &&
      designation === "admission_counsellor" &&
      String(refId || "").trim()
    ) {
      const collides = await studentExistsFor(schoolId, String(refId).trim());
      if (collides) {
        return res.status(409).json({
          success: false,
          message: "This ID belongs to an admitted student — it cannot be used as a counsellor's Staff ID",
        });
      }
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ success: false, message: "Email already registered" });

    // Register User must attach an EXISTING confirmed-admission Student shell —
    // a random/nonexistent Admission ID is rejected up-front so no account is
    // created (and subsequently rolled back) for an ID that cannot be linked.
    const admissionShell = role === "student" ? await studentExistsFor(schoolId, admissionId) : null;
    if (role === "student" && !admissionShell) {
      return res.status(400).json({
        success: false,
        message: "No pending student profile exists for this Admission ID in this school — confirm the admission first",
      });
    }

    // Parent (and any role carrying child links) must reference real, active,
    // same-school students — never a random or soft-deleted Admission ID.
    const links = await cleanAndValidateLinkedStudents(schoolId, linkedStudentIds);
    if (links.error) return res.status(400).json({ success: false, message: links.error });
    if (role === "parent" && !links.ids.length) {
      return res.status(400).json({
        success: false,
        message: "At least one student must be linked to a parent account",
      });
    }

    // Teacher/Staff accounts link to a person record created from
    // the Teachers & Staff page (Staff ID is entered manually on that page —
    // never generated). A nonexistent / already-linked / wrong-role Staff ID is
    // rejected up-front so no account is created for a record that cannot be
    // linked. The submitted Staff ID is the discovery key; the account's refId
    // stores the linked Staff._id (see ensureStaffLink).
    const staffId = staffLinkRequired(role) ? String(refId || "").trim() : null;
    const staffRecord = staffId ? await staffRecordFor(schoolId, staffId) : null;
    if (staffLinkRequired(role)) {
      if (!staffId) {
        return res.status(400).json({ success: false, message: `Staff ID (refId) is required for ${role} accounts` });
      }
      if (!staffRecord) {
        return res.status(400).json({ success: false, message: NO_PENDING_STAFF_MSG });
      }
      if (!STAFF_LINK_OK[role].includes(staffRecord.role)) {
        return res.status(400).json({
          success: false,
          message: `This Staff ID belongs to a ${staffRecord.role} record — it cannot be linked to a ${role} account`,
        });
      }
      // A counsellor's Staff ID must never collide with an admitted student's
      // Admission ID (their lookup surfaces could address the wrong person).
      if (role === "staff" && designation === "admission_counsellor") {
        const collides = await studentExistsFor(schoolId, staffId);
        if (collides) {
          return res.status(409).json({
            success: false,
            message: "This ID belongs to an admitted student — it cannot be used as a counsellor's Staff ID",
          });
        }
      }
      if (staffRecord.userId) {
        return res.status(409).json({ success: false, message: "This Staff ID is already linked to another active account" });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashed,
      role,
      schoolId,
      designation: designation || undefined,
      class: cls || undefined,
      section: section || undefined,
      phone,
      refId:
        role === "student"
          ? String(refId).trim()
          : staffRecord
            ? String(staffRecord._id)
            : (refId || null),
      linkedStudentIds: links.ids,
    });

    // Student accounts must resolve to a real student record in the SAME
    // school (PlatformUser.refId === Student.admissionNo). Failing to link
    // (e.g. a shell claimed concurrently, duplicate ownership) rolls the
    // account back.
    if (role === "student") {
      const linkResult = await ensureStudentLink({
        schoolId,
        admissionId,
        userId: user._id,
      });
      if (linkResult.status) {
        await User.deleteOne({ _id: user._id }).catch(() => {});
        return res.status(linkResult.status).json({ success: false, message: linkResult.message });
      }
    }

    // Staff/Teacher/Class Teacher accounts must resolve to a real person record
    // in the SAME school (user.refId === Staff._id). A concurrent claim /
    // duplicate ownership rolls the account back.
    if (staffLinkRequired(role)) {
      const linkResult = await ensureStaffLink({
        schoolId,
        employeeId: staffId,
        userRole: role,
        userId: user._id,
      });
      if (linkResult.status) {
        await User.deleteOne({ _id: user._id }).catch(() => {});
        return res.status(linkResult.status).json({ success: false, message: linkResult.message });
      }
    }

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: toPublicUser(user),
    });
    await writeAudit({ req, user: creator, action: "user.created", targetType: "user", targetId: user._id, message: `Created ${role} user ${user.email}` });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== "string" || !String(email).trim() || typeof password !== "string" || !password) {
      return res.status(400).json({ success: false, message: "email and password are required" });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: "Invalid credentials" });
    if (user.deletedAt) return res.status(403).json({ success: false, message: "This account has been removed. Contact your school administrator." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: "Invalid credentials" });

    let school = null;
    if (user.schoolId) {
      school = await School.findById(user.schoolId).lean();
      if (!school || school.status !== "active") {
        return res.status(403).json({ success: false, message: "Your school account is inactive" });
      }
      // Block school_admin login if onboarding is not complete
      if (user.role === "school_admin" && school.onboarding?.status !== "live") {
        return res.status(403).json({
          success: false,
          message: "School onboarding is not complete. Please complete the setup process.",
          code: "ONBOARDING_INCOMPLETE",
        });
      }
    }

    user.lastLogin = new Date();
    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const currentSession = school ? await resolveCurrentSessionInfo(school._id) : null;

    res.json({
      success: true,
      message: "Login successful",
      data: {
        accessToken,
        refreshToken,
        user: toPublicUser(user),
        school: school
          ? { id: school._id, name: school.name, code: school.code, shortName: school.shortName, logo: school.logo, session: school.session, currentSession, academicConfigConfirmed: Boolean(school.academicConfigConfirmed), plan: school.plan, status: school.status, onboarding: school.onboarding?.status || "live", city: school.city, state: school.state, pincode: school.pincode, board: school.board || "", recognitionNumber: school.recognitionNumber || "", recognitionAuthority: school.recognitionAuthority || "", recognitionVerified: Boolean(school.recognitionVerified), settings: school.settings || {} }
          : null,
      },
    });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: "refreshToken is required" });

    const decoded = jwt.verify(refreshToken, getJwtSecret());
    // Only refresh-typed tokens may be exchanged for a new access token.
    if (decoded.typ !== "refresh") {
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive || user.deletedAt) return res.status(401).json({ success: false, message: "Invalid refresh token" });
    // Refresh tokens issued before the password was last changed/reset are
    // invalidated so a credential change (or compromise response) kills all
    // existing sessions.
    if (user.passwordChangedAt && decoded.iat * 1000 <= user.passwordChangedAt.getTime()) {
      return res.status(401).json({ success: false, message: "Session expired, please log in again" });
    }

    const accessToken = generateAccessToken(user);
    res.json({ success: true, data: { accessToken, refreshToken } });
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let school = null;
    if (user.schoolId) {
      const doc = await School.findById(user.schoolId)
        .select("name code shortName city state pincode logo session plan status settings")
        .lean();
      if (doc) {
        const currentSession = await resolveCurrentSessionInfo(doc._id);
        school = { id: doc._id, name: doc.name, code: doc.code, shortName: doc.shortName, logo: doc.logo, session: doc.session, currentSession, academicConfigConfirmed: Boolean(doc.academicConfigConfirmed), plan: doc.plan, status: doc.status, city: doc.city, state: doc.state, pincode: doc.pincode, board: doc.board || "", recognitionNumber: doc.recognitionNumber || "", recognitionAuthority: doc.recognitionAuthority || "", recognitionVerified: Boolean(doc.recognitionVerified), settings: doc.settings || {} };
      }
    }

    res.json({ success: true, data: { user: toPublicUser(user), school } });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select("+password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.status(400).json({ success: false, message: "Old password incorrect" });

    const passErr = validatePassword(newPassword);
    if (passErr) return res.status(400).json({ success: false, message: passErr });

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const SELF_EDITABLE_FIELDS = ["name", "phone", "avatar"];

const updateMe = async (req, res) => {
  try {
    const patch = {};
    for (const key of SELF_EDITABLE_FIELDS) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }
    const user = await User.findByIdAndUpdate(req.user.id, patch, { new: true });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: toPublicUser(user) });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const uploadUserPhoto = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ success: false, message: "Photo file is required" });
    const uploadErr = assertAllowedUpload(req.file);
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr });
    }
    const imagekit = require("@school-erp/shared/src/config/imagekit");
    if (!imagekit)
      return res.status(503).json({ success: false, message: "Image provider is not configured" });
    const uploaded = await imagekit.upload({
      file: req.file.buffer.toString("base64"),
      fileName: `user-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-")}`,
      folder: "/school-erp/users",
      useUniqueFileName: true,
      transformation: { pre: "q-80,w-800,h-800,fo-auto" },
    });
    res.status(201).json({ success: true, data: { url: uploaded.url, fileId: uploaded.fileId } });
  } catch (err) {
    res.status(502).json({ success: false, message: err?.message || "Image upload failed" });
  }
};

const listUsers = async (req, res) => {
  try {
    const { role, schoolId, q, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (req.user.role === "super_admin") {
      const sid = schoolId || req.header("X-School-Id") || null;
      if (sid) filter.schoolId = sid;
    } else {
      filter.schoolId = req.user.schoolId;
    }
    if (role) filter.role = role;
    if (req.query.includeDeleted !== "true") filter.deletedAt = null;

    if (q && String(q).trim()) {
      const rx = new RegExp(
        String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      filter.$or = [{ name: rx }, { email: rx }, { refId: rx }];
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (p - 1) * l;

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(l),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, count: users.length, total, page: p, limit: l, pages: Math.ceil(total / l), data: users.map(toPublicUser) });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// Only super_admin can modify super_admin/school_admin; school admins manage
// staff/teachers/students/parents within their own school only.
const loadManageableUser = async (editor, targetId) => {
  const target = await User.findById(targetId);
  if (!target) return { error: { status: 404, message: "User not found" } };

  if (editor.role === "super_admin") return target;

  if (editor.role !== "school_admin") {
    return { error: { status: 403, message: "Access denied for this role" } };
  }
  if (String(target.schoolId) !== String(editor.schoolId)) {
    return { error: { status: 403, message: "Cannot manage user from another school" } };
  }
  if (["super_admin", "school_admin"].includes(target.role)) {
    return { error: { status: 403, message: "Cannot manage this role" } };
  }
  return target;
};

const updateUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== "boolean") return res.status(400).json({ success: false, message: "isActive must be a boolean" });

    const target = await loadManageableUser(req.user, req.params.id);
    if (target.error) return res.status(target.error.status).json({ success: false, message: target.error.message });
    if (target.deletedAt) return res.status(400).json({ success: false, message: "Restore the user before changing status" });

    target.isActive = isActive;
    await target.save();
    await writeAudit({ req, user: req.user, action: isActive ? "user.activated" : "user.deactivated", targetType: "user", targetId: target._id, message: `${isActive ? "Activated" : "Deactivated"} user ${target.email}` });
    res.json({ success: true, data: toPublicUser(target) });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// Soft delete: preserves the record (and history) while locking access.
const deleteUser = async (req, res) => {
  try {
    const target = await loadManageableUser(req.user, req.params.id);
    if (target.error) return res.status(target.error.status).json({ success: false, message: target.error.message });
    if (String(target._id) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account" });
    }

    target.deletedAt = new Date();
    target.isActive = false;
    await target.save();
    await writeAudit({ req, user: req.user, action: "user.soft_deleted", targetType: "user", targetId: target._id, message: `Soft-deleted user ${target.email}` });
    res.json({ success: true, message: "User removed and access revoked. History is preserved." });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// Restore a soft-deleted user (super_admin / same-school school_admin).
const restoreUser = async (req, res) => {
  try {
    const target = await loadManageableUser(req.user, req.params.id);
    if (target.error) return res.status(target.error.status).json({ success: false, message: target.error.message });

    target.deletedAt = null;
    target.isActive = true;
    await target.save();
    await writeAudit({ req, user: req.user, action: "user.restored", targetType: "user", targetId: target._id, message: `Restored user ${target.email}` });
    res.json({ success: true, message: "User restored", data: toPublicUser(target) });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// Update editable profile fields for a manageable user (no roles/emails by
// design here; role changes are a prompted, audited flow).
const updateUser = async (req, res) => {
  try {
    const { designation, class: cls, section, phone, refId, name, linkedStudentIds } = req.body;
    const target = await loadManageableUser(req.user, req.params.id);
    if (target.error) return res.status(target.error.status).json({ success: false, message: target.error.message });
    if (target.deletedAt) return res.status(400).json({ success: false, message: "Restore the user before editing" });

    if (name !== undefined) target.name = String(name).trim();
    if (designation !== undefined) target.designation = designation || null;
    if (cls !== undefined) target.class = cls || null;
    if (section !== undefined) target.section = section || null;
    if (phone !== undefined && phone && !PHONE_RE.test(String(phone).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid phone number" });
    }
    if (phone !== undefined) target.phone = phone || null;
    if (target.role === "student") {
      const newRef = refId !== undefined ? String(refId || "").trim() : (target.refId || "");
      if (!newRef) {
        return res.status(400).json({ success: false, message: "Admission ID is required for student accounts" });
      }
      if (newRef !== target.refId) {
        const linkResult = await ensureStudentLink({
          schoolId: target.schoolId,
          admissionId: newRef,
          userId: target._id,
        });
        if (linkResult.status) {
          return res.status(linkResult.status).json({ success: false, message: linkResult.message });
        }
      }
      target.refId = newRef;
    } else if (staffLinkRequired(target.role) && refId !== undefined) {
      // Staff/Teacher/Class Teacher refId changes re-link to another existing
      // person record (same school, right role, not claimed by another account).
      const trimmed = String(refId || "").trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, message: `Staff ID is required for ${target.role} accounts` });
      }
      if (trimmed !== target.refId) {
        const staffRec = await staffRecordFor(target.schoolId, trimmed);
        if (!staffRec) return res.status(400).json({ success: false, message: NO_PENDING_STAFF_MSG });
        if (!STAFF_LINK_OK[target.role].includes(staffRec.role)) {
          return res.status(400).json({
            success: false,
            message: `This Staff ID belongs to a ${staffRec.role} record — it cannot be linked to a ${target.role} account`,
          });
        }
        if (target.role === "staff" && (target.designation || designation) === "admission_counsellor") {
          const collides = await studentExistsFor(target.schoolId, trimmed);
          if (collides) {
            return res.status(409).json({
              success: false,
              message: "This ID belongs to an admitted student — it cannot be used as a counsellor's Staff ID",
            });
          }
        }
        if (staffRec.userId && String(staffRec.userId) !== String(target._id)) {
          return res.status(409).json({ success: false, message: "This Staff ID is already linked to another active account" });
        }
        const { getStaffModel } = require("../db/staffDb");
        const Staff = await getStaffModel();
        if (target.refId) {
          await Staff.updateOne(
            { schoolId: target.schoolId, _id: target.refId },
            { $set: { userId: null } },
          ).catch(() => {});
        }
        target.refId = String(staffRec._id);
        await Staff.updateOne({ _id: staffRec._id }, { $set: { userId: String(target._id) } }).catch(() => {});
      }
    } else if (refId !== undefined) {
      const trimmed = String(refId || "").trim();
      if (
        target.role === "staff" &&
        (target.designation || designation) === "admission_counsellor" &&
        trimmed
      ) {
        const collides = await studentExistsFor(target.schoolId, trimmed);
        if (collides) {
          return res.status(409).json({
            success: false,
            message: "This ID belongs to an admitted student — it cannot be used as a counsellor's Staff ID",
          });
        }
      }
      target.refId = trimmed || null;
    }
    if (linkedStudentIds !== undefined) {
      const links = await cleanAndValidateLinkedStudents(target.schoolId, linkedStudentIds);
      if (links.error) return res.status(400).json({ success: false, message: links.error });
      if (target.role === "parent" && !links.ids.length) {
        return res.status(400).json({
          success: false,
          message: "A parent account must stay linked to at least one student",
        });
      }
      target.linkedStudentIds = links.ids;
    }

    await target.save();
    await writeAudit({ req, user: req.user, action: "user.updated", targetType: "user", targetId: target._id, message: `Updated user ${target.email}` });
    res.json({ success: true, data: toPublicUser(target) });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// Password recovery (no email/SMS provider in the fleet — admin-initiated).
// An authorised admin generates a short-lived, single-use reset link and hands
// the token to the user out-of-band (in person / phone). Access tokens are
// never issued through this flow and no reset token is ever delivered to an
// unauthenticated caller.
const adminResetPassword = async (req, res) => {
  try {
    const target = await loadManageableUser(req.user, req.params.id);
    if (target.error) return res.status(target.error.status).json({ success: false, message: target.error.message });
    if (target.deletedAt) return res.status(400).json({ success: false, message: "Restore the user before resetting the password" });
    if (!target.isActive) return res.status(400).json({ success: false, message: "Activate the user before resetting the password" });

    const token = jwt.sign(
      { sub: String(target._id), purpose: "password-reset" },
      getJwtSecret(),
      { expiresIn: 15 * 60 },
    );
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${encodeURIComponent(token)}`;

    await writeAudit({ req, user: req.user, action: "user.password_reset_generated", targetType: "user", targetId: target._id, message: `Generated password reset link for ${target.email}` });
    res.json({
      success: true,
      message: "Password reset link generated",
      data: { resetLink, expiresInMinutes: 15, resetUserId: String(target._id) },
    });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// Public endpoint: applies a reset link. The token is the only secret; links
// are signed, short-lived and single-use (passwordChangedAt watermark).
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ success: false, message: "token and newPassword are required" });

    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link" });
    }
    if (decoded.purpose !== "password-reset" || !decoded.sub) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link" });
    }

    const passErr = validatePassword(newPassword);
    if (passErr) return res.status(400).json({ success: false, message: passErr });

    const user = await User.findById(decoded.sub).select("+password");
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired reset link" });
    if (!user.isActive || user.deletedAt) {
      return res.status(403).json({ success: false, message: "This account is inactive or has been removed" });
    }
    if (user.schoolId) {
      const school = await School.findById(user.schoolId).select("status").lean();
      if (!school || school.status !== "active") {
        return res.status(403).json({ success: false, message: "Your school account is inactive" });
      }
    }

    const issuedAtMs = decoded.iat * 1000;
    if (user.passwordChangedAt && issuedAtMs <= user.passwordChangedAt.getTime()) {
      return res.status(400).json({ success: false, message: "This reset link has already been used" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date(issuedAtMs);
    await user.save();
    await writeAudit({ req, user: { id: user._id, email: user.email, role: user.role }, action: "user.password_reset", targetType: "user", targetId: user._id, message: `Password reset for ${user.email}` });
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// ── OTP-based Password Reset ────────────────────────────────────────────────

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const maskEmail = (email) => {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 4))}${local.slice(-1)}@${domain}`;
};

const otpEmailHtml = (otp, name) => `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">
  <div style="background:#1C2331;border-radius:12px;padding:24px;margin-bottom:24px">
    <p style="color:#E8A33D;font-weight:bold;font-size:18px;margin:0">Zipschool OS</p>
  </div>
  <h2 style="color:#1C2331;font-size:20px;margin-bottom:8px">Password Reset OTP</h2>
  <p style="color:#555;font-size:14px;line-height:1.6">Hi ${name || "there"},</p>
  <p style="color:#555;font-size:14px;line-height:1.6">Your one-time password for resetting your password is:</p>
  <div style="background:#F5F5F5;border-radius:8px;padding:16px;text-align:center;margin:20px 0">
    <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1C2331">${otp}</span>
  </div>
  <p style="color:#555;font-size:14px;line-height:1.6">This OTP is valid for <strong>10 minutes</strong>. If you did not request this, please ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
  <p style="color:#999;font-size:12px">Zipschool OS &copy; ${new Date().getFullYear()}</p>
</div>`;

const MAX_OTP_REQUESTS = 3;
const OTP_WINDOW_MS = 15 * 60 * 1000;

const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, message: "email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    const genericMsg = "If an account with that email exists, an OTP has been sent";

    if (!user) return res.json({ success: true, message: genericMsg });
    if (!user.isActive || user.deletedAt) return res.json({ success: true, message: genericMsg });
    if (user.role === "super_admin") {
      return res.json({ success: true, message: genericMsg });
    }

    const cutoff = new Date(Date.now() - OTP_WINDOW_MS);
    const recentCount = await OtpToken.countDocuments({
      userId: user._id,
      purpose: "password-reset",
      createdAt: { $gte: cutoff },
    });
    if (recentCount >= MAX_OTP_REQUESTS) {
      return res.status(429).json({ success: false, message: "Too many requests. Please try again after 15 minutes." });
    }

    await OtpToken.updateMany(
      { userId: user._id, purpose: "password-reset", used: false },
      { $set: { used: true } },
    );

    const plainOtp = generateOtp();
    const hashedOtp = await bcrypt.hash(plainOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OtpToken.create({
      userId: user._id,
      email: normalizedEmail,
      otp: hashedOtp,
      purpose: "password-reset",
      expiresAt,
    });

    await sendEmail({
      to: normalizedEmail,
      subject: "Your Password Reset OTP — Zipschool OS",
      html: otpEmailHtml(plainOtp, user.name),
    });

    await writeAudit({
      req,
      user: { id: user._id, email: user.email, role: user.role },
      action: "user.password_reset_otp_sent",
      targetType: "user",
      targetId: user._id,
      message: `OTP sent to ${user.email}`,
    });

    res.json({ success: true, message: genericMsg, data: { maskedEmail: maskEmail(normalizedEmail) } });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const MAX_OTP_ATTEMPTS = 5;

const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: "email and otp are required" });

    const normalizedEmail = email.trim().toLowerCase();
    const otpDoc = await OtpToken.findOne({
      email: normalizedEmail,
      purpose: "password-reset",
      used: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    if (otpDoc.attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ success: false, message: "Too many failed attempts. Please request a new OTP." });
    }

    const valid = await bcrypt.compare(String(otp).trim(), otpDoc.otp);
    if (!valid) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      const remaining = MAX_OTP_ATTEMPTS - otpDoc.attempts;
      if (remaining <= 0) {
        return res.status(429).json({ success: false, message: "Too many failed attempts. Please request a new OTP." });
      }
      return res.status(400).json({ success: false, message: `Invalid OTP. ${remaining} attempt(s) remaining.` });
    }

    const resetToken = jwt.sign(
      { sub: String(otpDoc.userId), purpose: "otp-verified-reset", otpId: String(otpDoc._id) },
      getJwtSecret(),
      { expiresIn: 10 * 60 },
    );

    res.json({
      success: true,
      message: "OTP verified successfully",
      data: { resetToken, expiresInMinutes: 10 },
    });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const resetPasswordWithOtp = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ success: false, message: "token and newPassword are required" });

    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    }
    if (decoded.purpose !== "otp-verified-reset" || !decoded.sub || !decoded.otpId) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    }

    const passErr = validatePassword(newPassword);
    if (passErr) return res.status(400).json({ success: false, message: passErr });

    const user = await User.findById(decoded.sub).select("+password");
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    if (!user.isActive || user.deletedAt) {
      return res.status(403).json({ success: false, message: "This account is inactive or has been removed" });
    }
    if (user.schoolId) {
      const school = await School.findById(user.schoolId).select("status").lean();
      if (!school || school.status !== "active") {
        return res.status(403).json({ success: false, message: "Your school account is inactive" });
      }
    }

    const otpDoc = await OtpToken.findById(decoded.otpId);
    if (!otpDoc || otpDoc.used) {
      return res.status(400).json({ success: false, message: "This reset token has already been used" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();

    otpDoc.used = true;
    await otpDoc.save();

    await writeAudit({
      req,
      user: { id: user._id, email: user.email, role: user.role },
      action: "user.password_reset_otp",
      targetType: "user",
      targetId: user._id,
      message: `Password reset via OTP for ${user.email}`,
    });

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const adminSendResetOtp = async (req, res) => {
  try {
    const target = await loadManageableUser(req.user, req.params.id);
    if (target.error) return res.status(target.error.status).json({ success: false, message: target.error.message });
    if (target.deletedAt) return res.status(400).json({ success: false, message: "Restore the user before sending OTP" });
    if (!target.isActive) return res.status(400).json({ success: false, message: "Activate the user before sending OTP" });

    const normalizedEmail = target.email.toLowerCase();

    await OtpToken.updateMany(
      { userId: target._id, purpose: "password-reset", used: false },
      { $set: { used: true } },
    );

    const plainOtp = generateOtp();
    const hashedOtp = await bcrypt.hash(plainOtp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OtpToken.create({
      userId: target._id,
      email: normalizedEmail,
      otp: hashedOtp,
      purpose: "password-reset",
      expiresAt,
    });

    await sendEmail({
      to: normalizedEmail,
      subject: "Your Password Reset OTP — Zipschool OS",
      html: otpEmailHtml(plainOtp, target.name),
    });

    await writeAudit({
      req,
      user: req.user,
      action: "user.password_reset_otp_sent_admin",
      targetType: "user",
      targetId: target._id,
      message: `Admin sent OTP to ${target.email}`,
    });

    res.json({
      success: true,
      message: `OTP sent to ${maskEmail(normalizedEmail)}`,
      data: { maskedEmail: maskEmail(normalizedEmail) },
    });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// School / tenant management (platform layer) -------------------------------

// Normalize a user-typed string into a clean URL-safe slug.
// Only applied to NEW schools — existing codes are never rewritten.
const normalizeCode = (raw) =>
  String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")   // unsupported chars → dash
    .replace(/-{2,}/g, "-")        // collapse consecutive dashes
    .replace(/^-+/, "")            // strip leading dashes
    .replace(/-+$/, "");           // strip trailing dashes

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;

const createSchool = async (req, res) => {
  try {
    const { name, code, shortName, address, city, state, pincode, phone, email, logo, session, sessionStart, sessionEnd, plan, status } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: "name and code are required" });

    // --- Field validation ---
    if (email && !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid school email" });
    }
    if (phone && !PHONE_RE.test(String(phone).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid phone number" });
    }
    if (pincode && !PINCODE_RE.test(String(pincode).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid 6-digit pincode" });
    }

    // --- Duplicate school name detection (case-insensitive, trimmed) ---
    const trimmedName = String(name).trim();
    const nameRegex = new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const nameClash = await School.findOne({ name: nameRegex }).lean();
    if (nameClash) {
      return res.status(409).json({ success: false, message: "A school with this name already exists" });
    }

    // --- Code slugification (new schools only — existing codes untouched) ---
    const codeSlug = normalizeCode(code);
    if (!codeSlug) {
      return res.status(400).json({ success: false, message: "School code must contain at least one letter or number" });
    }
    const existing = await School.findOne({ code: codeSlug });
    if (existing) return res.status(409).json({ success: false, message: "This School Code is already in use" });

    const school = await School.create({
      name: trimmedName, code: codeSlug,
      shortName: shortName ? String(shortName).trim() : undefined,
      address: address ? String(address).trim() : undefined,
      city: city ? String(city).trim() : undefined,
      state: state ? String(state).trim() : undefined,
      pincode: pincode ? String(pincode).trim() : undefined,
      phone: phone ? String(phone).trim() : undefined,
      email: email ? String(email).trim().toLowerCase() : undefined,
      logo, session, plan, status,
    });

    // --- Auto-create Academic Session for the school ---
    try {
      const AcademicSession = require("../models/AcademicSession");
      const rawSession = String(session || "").trim();
      const now = new Date();
      const currentYear = now.getFullYear();

      // Explicit start/end dates (Org Profile "Academic Configuration" inputs)
      // take priority; otherwise fall back to string inference so a bare
      // "2026-27" / "2026" still bootstraps sensibly. Dates are never assumed
      // to be April-March — the school configures its own calendar.
      const parseDate = (value) => {
        if (value === undefined || value === null || value === "") return null;
        const d = new Date(String(value));
        return Number.isNaN(d.getTime()) ? null : d;
      };
      let startDate = parseDate(sessionStart);
      let endDate = parseDate(sessionEnd);

      let sessionName = null;
      if (startDate && endDate) {
        if (endDate.getTime() <= startDate.getTime()) {
          console.warn("[auth] invalid sessionStart/sessionEnd (end <= start); falling back to string inference");
          startDate = null;
          endDate = null;
        } else {
          sessionName = deriveSessionName(startDate, endDate);
        }
      }

      // Fallback: infer Apr->Mar window + canonical "2026-27" label from the
      // submitted session string (also covers empty session for a default year).
      if (!startDate || !endDate) {
        const fullRangeMatch = rawSession.match(/(\d{4})\s*[-–]\s*(\d{4})/);
        const shortRangeMatch = rawSession.match(/(\d{4})\s*[-–]\s*(\d{2})$/);
        const singleYearMatch = rawSession.match(/^(\d{4})$/);
        let y1;
        if (fullRangeMatch) y1 = parseInt(fullRangeMatch[1], 10);
        else if (shortRangeMatch) y1 = parseInt(shortRangeMatch[1], 10);
        else if (singleYearMatch) y1 = parseInt(singleYearMatch[1], 10);
        else y1 = currentYear;
        startDate = new Date(`${y1}-04-01`);
        endDate = new Date(`${y1 + 1}-03-31`);
      }
      if (!sessionName) sessionName = deriveSessionName(startDate, endDate);
      if (!sessionName) sessionName = rawSession || `${currentYear}-${String((currentYear + 1) % 100).padStart(2, "0")}`;

      const existingSession = await AcademicSession.findOne({ schoolId: school._id, name: sessionName }).lean();
      if (!existingSession) {
        const academicSession = await AcademicSession.create({
          schoolId: school._id,
          name: sessionName,
          startDate,
          endDate,
          status: "active",
          isCurrent: true,
        });
        // Keep legacy School.session in sync
        await School.updateOne({ _id: school._id }, { $set: { session: academicSession.name } });
      }
    } catch (sessErr) {
      // Non-fatal: school is created but session creation failed.
      // Log clearly so operators can investigate; onboarding continues.
      console.error("[auth] academic session auto-create failed for " + codeSlug + ":", sessErr.message);
    }

    // Every school starts on the platform-hosted gateway (best-effort; the
    // startup backfill covers any failure here).
    try {
      await PaymentGateway.create({ schoolId: school._id, mode: "platform", status: "active" });
    } catch (gwErr) {
      console.error("[auth] gateway seed failed for " + codeSlug + ":", gwErr.message);
    }
    await writeAudit({ req, user: req.user, action: "school.created", targetType: "school", targetId: school._id, message: `Created school ${trimmedName} (${codeSlug})` });
    res.status(201).json({ success: true, message: "School created successfully", data: school });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const listSchools = async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query, { fallback: 50, max: 200 });
    const filter = {};
    if (req.query.q && String(req.query.q).trim()) {
      filter.name = { $regex: String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    const [schools, total] = await Promise.all([
      School.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      School.countDocuments(filter),
    ]);
    res.json({ success: true, count: schools.length, total, ...pageInfo(total, page, limit), data: schools });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const getSchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });
    res.json({ success: true, data: school });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const updateSchool = async (req, res) => {
  try {
    const patch = {};
    for (const key of SCHOOL_EDITABLE_FIELDS) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    const school = await School.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!school) return res.status(404).json({ success: false, message: "School not found" });
    await writeAudit({ req, user: req.user, action: "school.updated", targetType: "school", targetId: school._id, message: `Updated school fields: ${Object.keys(patch).join(", ") || "(none)"}` });
    res.json({ success: true, message: "School updated successfully", data: school });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const verify = async (req, res) => {
  res.json({ success: true, data: req.user });
};

// ------------------------------------------------- self-service school branding
// Report-card customization lives on the school record: top-level logo/address
// plus settings.reportCard (affiliation, tagline, footerNote, accent). Only a
// whitelist is editable so a school admin can never touch platform settings.
const REPORT_CARD_SETTINGS_FIELDS = ["affiliation", "tagline", "footerNote", "accent"];
const ID_CARD_SETTINGS_FIELDS = [
  "accent",
  "headerTitle",
  "footerNote",
  "showParentContact",
  "showBloodGroup",
  "showDob",
  "showRollNo",
  "showHouse",
];
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const BOOL_RE = /^(true|false)$/i;

// Logo may be an http(s) URL or an uploaded base64 data URI (capped size).
// Returns null when invalid, "" when explicitly cleared.
const sanitizeLogo = (logo) => {
  if (logo == null) return "";
  if (typeof logo !== "string") return null;
  const str = logo.trim();
  if (str === "") return "";
  if (str.length > 2_000_000) return null;
  if (/^https?:\/\//i.test(str)) return str;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(str)) return str;
  return null;
};

// Shape exposed to the client for self-service school endpoints. Mirrors the
// login `school` payload while adding address + settings for the admin UI.
const publicSchool = (s) =>
  s && {
    id: s._id,
    name: s.name,
    code: s.code,
    shortName: s.shortName || "",
    email: s.email || "",
    phone: s.phone || "",
    address: s.address || "",
    city: s.city || "",
    state: s.state || "",
    pincode: s.pincode || "",
    website: s.website || "",
    logo: s.logo || "",
    board: s.board || "",
    recognitionNumber: s.recognitionNumber || "",
    recognitionAuthority: s.recognitionAuthority || "",
    recognitionVerified: Boolean(s.recognitionVerified),
    recognitionVerifiedAt: s.recognitionVerifiedAt || null,
    session: s.session || "",
    academicConfigConfirmed: Boolean(s.academicConfigConfirmed),
    plan: s.plan || "trial",
    status: s.status || "active",
    settings: s.settings || {},
  };

const getMySchool = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(400).json({ success: false, message: "No school context" });
    }
    const school = await School.findById(req.tenantId).lean();
    if (!school) return res.status(404).json({ success: false, message: "School not found" });
    const currentSession = await resolveCurrentSessionInfo(req.tenantId);
    res.json({ success: true, data: { ...publicSchool(school), currentSession } });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

const updateMySchool = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(400).json({ success: false, message: "No school context" });
    }
    const school = await School.findById(req.tenantId);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });

    const set = {};
    if (req.body.shortName !== undefined) set.shortName = String(req.body.shortName).trim();
    if (req.body.name !== undefined) {
      const trimmedName = String(req.body.name).trim();
      if (!trimmedName) {
        return res.status(400).json({ success: false, message: "School name cannot be empty" });
      }
      // Duplicate name detection (skip if name unchanged)
      if (trimmedName !== school.name) {
        const nameRegex = new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
        const nameClash = await School.findOne({ name: nameRegex, _id: { $ne: school._id } }).lean();
        if (nameClash) {
          return res.status(409).json({ success: false, message: "A school with this name already exists" });
        }
      }
      set.name = trimmedName;
    }
    if (req.body.address !== undefined) set.address = String(req.body.address).trim();
    if (req.body.city !== undefined) set.city = String(req.body.city).trim();
    if (req.body.state !== undefined) set.state = String(req.body.state).trim();
    if (req.body.pincode !== undefined) {
      const pc = String(req.body.pincode).trim();
      if (pc && !PINCODE_RE.test(pc)) {
        return res.status(400).json({ success: false, message: "Please enter a valid 6-digit pincode" });
      }
      set.pincode = pc;
    }
    if (req.body.email !== undefined) {
      const em = String(req.body.email).trim();
      if (em && !EMAIL_RE.test(em)) {
        return res.status(400).json({ success: false, message: "Please enter a valid school email" });
      }
      set.email = em ? em.toLowerCase() : "";
    }
    if (req.body.phone !== undefined) {
      const ph = String(req.body.phone).trim();
      if (ph && !PHONE_RE.test(ph)) {
        return res.status(400).json({ success: false, message: "Please enter a valid phone number" });
      }
      set.phone = ph;
    }
    if (req.body.logo !== undefined) {
      const logo = sanitizeLogo(req.body.logo);
      if (logo === null) {
        return res.status(400).json({
          success: false,
          message: "Logo must be an image URL or an uploaded image (max 2MB)",
        });
      }
      set.logo = logo;
    }
    if (req.body.website !== undefined) {
      const ws = String(req.body.website).trim();
      if (ws && !/^https?:\/\/.+/i.test(ws)) {
        return res.status(400).json({ success: false, message: "Please enter a valid website URL (https://...)" });
      }
      set.website = ws;
    }

    const rc = req.body.reportCard;
    if (rc && typeof rc === "object") {
      for (const key of REPORT_CARD_SETTINGS_FIELDS) {
        if (rc[key] === undefined) continue;
        if (key === "accent") {
          const value = String(rc[key] || "").trim();
          if (!ACCENT_RE.test(value)) {
            return res.status(400).json({ success: false, message: "Accent must be a hex color like #E8A33D" });
          }
          set[`settings.reportCard.${key}`] = value;
        } else {
          set[`settings.reportCard.${key}`] = String(rc[key] ?? "").trim();
        }
      }
    }

    const idc = req.body.idCard;
    if (idc && typeof idc === "object") {
      for (const key of ID_CARD_SETTINGS_FIELDS) {
        if (idc[key] === undefined) continue;
        const path = `settings.idCard.${key}`;
        if (key === "accent") {
          const value = String(idc[key] || "").trim();
          if (!ACCENT_RE.test(value)) {
            return res.status(400).json({ success: false, message: "ID card accent must be a hex color like #1E2A44" });
          }
          set[path] = value;
        } else if (key.startsWith("show") && typeof idc[key] === "boolean") {
          set[path] = idc[key];
        } else {
          set[path] = String(idc[key] ?? "").trim();
        }
      }
    }

    if (req.body.bannerImage !== undefined) {
      const banner = sanitizeLogo(req.body.bannerImage);
      if (banner === null) {
        return res.status(400).json({
          success: false,
          message: "Banner image must be an image URL or an uploaded image (max 2MB)",
        });
      }
      set["settings.bannerImage"] = banner;
    }

    if (Object.keys(set).length) {
      await School.updateOne({ _id: school._id }, { $set: set });
    }

    const fresh = await School.findById(school._id).lean();
    await writeAudit({
      req,
      user: req.user,
      action: "school.settings_updated",
      targetType: "school",
      targetId: school._id,
      message: "School updated branding (report card / ID card)",
    });
    res.json({ success: true, message: "School branding updated", data: publicSchool(fresh) });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

// Hard delete — permanently removes the user document. Only for super_admin
// and only on already soft-deleted users to prevent accidental live deletions.
const hardDeleteUser = async (req, res) => {
  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ success: false, message: "Only platform owner can permanently delete users" });
    }
    const target = await loadManageableUser(req.user, req.params.id);
    if (target.error) return res.status(target.error.status).json({ success: false, message: target.error.message });
    if (!target.deletedAt) {
      return res.status(400).json({ success: false, message: "User must be removed (soft-deleted) before permanent deletion" });
    }
    const email = target.email;
    const User = target.constructor;
    await User.deleteOne({ _id: target._id });
    await writeAudit({ req, user: req.user, action: "user.hard_deleted", targetType: "user", targetId: target._id, message: `Permanently deleted user ${email}` });
    res.json({ success: true, message: "User permanently deleted" });
  } catch (err) {
    return unexpectedError(res, err);
  }
};

module.exports = {
  createUser, login, refreshToken, getMe, changePassword,
  listUsers, updateUserStatus, deleteUser, hardDeleteUser, restoreUser, updateUser,
  adminResetPassword, resetPassword,
  requestPasswordReset, verifyResetOtp, resetPasswordWithOtp, adminSendResetOtp,
  createSchool, listSchools, getSchool, updateSchool,
  getMySchool, updateMySchool,
  verify, updateMe, uploadUserPhoto,
};
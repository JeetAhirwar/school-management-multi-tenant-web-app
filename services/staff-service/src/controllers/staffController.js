const Staff = require("../models/Staff");
const TeacherAssignment = require("../models/TeacherAssignment");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { pushNotifications } = require("../utils/notify");
const { assertAllowedUpload } = require("@school-erp/shared/src/utils/uploads");

// Escapes regex metacharacters in user search terms to prevent regex
// injection / ReDoS-style patterns; length-capped to bound scan cost.
const escapeRegex = (term) =>
  String(term).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Mass-assignment guard: only these fields may be set from the request body
// (userId / schoolId / _id / timestamps / profileStatus / profileCompletedAt /
// idCardNumber / idCardIssuedAt stay server-owned). Designation is free text —
// the existing architecture lets each school define its own designations.
const STAFF_FIELDS = [
  "employeeId", "name", "designation", "department", "role", "subjects",
  "classesAssigned", "qualification", "joiningDate", "contact", "email",
  "address", "photoUrl", "dob", "gender", "salary", "status",
];

// Fields a Staff/Teacher/Class Teacher user may update on their OWN record
// (self-service). Everything else (designation, salary, employeeId, role, …)
// stays admin-controlled.
const STAFF_SELF_EDITABLE = ["dob", "gender", "contact", "address", "photoUrl"];

// The ONE profile-completion rule for every person record (Teacher, Class
// Teacher and Staff share this rule; Student keeps its own). A record is
// complete once these identity fields exist — shared with the Complete-Profile
// gate on both the admin and self-service UIs.
const STAFF_PROFILE_FIELDS = ["dob", "gender", "contact", "address", "photoUrl"];

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === "";

const PHONE_RE = /^[+]?[0-9\s-]{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isDuplicateKey = (err) =>
  err && (err.code === 11000 || (err.name === "MongoServerError" && err.code === 11000));

// Derived server-side so "incomplete"/"complete" can never drift between UI
// surfaces. Keeps the original completion timestamp once completed.
const applyProfileDerivation = (staff) => {
  const missing = STAFF_PROFILE_FIELDS.filter((f) => isEmpty(staff[f]));
  staff.profileStatus = missing.length ? "incomplete" : "complete";
  staff.profileCompletedAt =
    staff.profileStatus === "complete" ? (staff.profileCompletedAt || new Date()) : null;
  return missing;
};

// Idempotent card assignment: keeps an existing idCardNumber forever, so
// repeated completions / edits / manual reissues never mint a duplicate card.
const assignIdCard = (staff) => {
  if (staff.idCardNumber) return;
  const year = String(new Date().getFullYear());
  const seq = String(staff.employeeId || staff._id)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  staff.idCardNumber = `${seq ? `${seq}-` : ""}${year}-${String(staff._id).slice(-4).toUpperCase()}`;
};

// Completing a profile auto-issues the card (idempotent). Mirrors how the
// student card is issued on onboarding — shared Staff/ID-card infrastructure.
const issueCardIfReady = (staff) => {
  if (staff.profileStatus !== "complete" || staff.idCardNumber) return;
  assignIdCard(staff);
  staff.idCardIssuedAt = new Date();
};

const touchStaffNotice = (req, staff, title, message, link = "/staff") => {
  if (staff.userId) {
    pushNotifications({
      token: req.token,
      schoolId: req.tenantId,
      userIds: [staff.userId],
      title,
      message,
      kind: "staff",
      link,
    });
  }
};

const createStaff = async (req, res) => {
  try {
    const payload = pick(req.body, STAFF_FIELDS);
    if (payload.employeeId !== undefined) payload.employeeId = String(payload.employeeId).trim();
    if (isEmpty(payload.name)) {
      return res.status(400).json({ success: false, message: "Staff name is required" });
    }
    if (payload.email !== undefined && String(payload.email).trim() !== "" && !EMAIL_RE.test(String(payload.email).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    if (payload.contact !== undefined && String(payload.contact).trim() !== "" && !PHONE_RE.test(String(payload.contact).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid phone number" });
    }
    const staff = await Staff.create({ ...payload, schoolId: req.tenantId });
    // A fully-filled record is complete immediately (admin-driven completion)
    // and auto-issues its card.
    applyProfileDerivation(staff);
    issueCardIfReady(staff);
    await staff.save();
    touchStaffNotice(
      req, staff,
      "Staff profile created",
      `Your staff profile (${staff.employeeId || "—"}) was created by the school admin.`,
    );
    res.status(201).json({ success: true, data: staff });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return res.status(409).json({
        success: false,
        message: "This Staff ID already exists in this school — Staff IDs are manual and unique per school",
      });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getStaff = async (req, res) => {
  try {
    const { department, role, status, search } = req.query;
    const filter = { schoolId: req.tenantId };
    const { page, limit, skip } = paginate(req.query);
    const isAdminRole = ["school_admin", "super_admin"].includes(req.user.role);

    if (["teacher", "staff"].includes(req.user.role)) {
      // Guard: an unlinked account (refId missing) must not degrade into an
      // unscoped find() — mongoose silently drops undefined filters, which
      // would enumerate every staff record (incl. salaries).
      if (!req.user.refId) {
        return res.json({ success: true, count: 0, total: 0, ...pageInfo(0, page, limit), data: [] });
      }
      filter._id = req.user.refId;
    }

    if (department) filter.department = department;
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };

    // Salary PII: only school/super admins receive salary in list responses.
    // Staff/teachers read their OWN salary via /me (getMyStaff) and the
    // StaffDashboard profile card.
    const [staff, total] = await Promise.all([
      Staff.find(filter)
        .select(isAdminRole ? undefined : "-salary")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Staff.countDocuments(filter),
    ]);
    res.json({ success: true, count: staff.length, total, ...pageInfo(total, page, limit), data: staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------------------------------------
// Pending person registrations: Staff records (userId null) awaiting a
// Platform User account, produced by Teachers/Staff record creation. A shared
// queue for every person type — Teachers today, Class Teachers & Staff later —
// so Register User always links to an EXISTING record (never fabricates one).
// Admin surface only (users:manage at the route). Optional ?role= filter so the
// Users & Access tabs (Teachers / Class Teachers / Staff) all reuse it.
// ---------------------------------------------------------------------------
const getPendingRegistrations = async (req, res) => {
  try {
    const { page = 1, limit = 20, role } = req.query;
    const filter = { schoolId: req.tenantId, userId: null };
    if (role) filter.role = role;
    const staff = await Staff.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select(
        "name employeeId designation role subjects classesAssigned qualification contact email profileStatus status createdAt",
      );
    const total = await Staff.countDocuments(filter);
    res.json({
      success: true,
      count: staff.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: staff,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// "Current person" for a Staff/Teacher/Class Teacher account — resolves the
// record via schoolId + refId (the linked Staff._id), exactly like every other
// staff-scoped request.
const getMyStaff = async (req, res) => {
  try {
    if (!["teacher", "staff"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only a staff, teacher or class-teacher account can request its own profile",
      });
    }
    if (!req.user.refId) {
      return res.status(404).json({
        success: false,
        message: "No Staff ID linked to this account",
      });
    }
    const staff = await Staff.findOne({ _id: req.user.refId, schoolId: req.tenantId });
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "No staff profile found. Contact your school admin.",
      });
    }
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getStaffById = async (req, res) => {
  try {
    const staff = await Staff.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateStaff = async (req, res) => {
  try {
    // Staff/Teacher/Class Teacher users reach here only for their OWN record
    // (restrictToOwnStaff) and may only touch self-service fields. Admins keep
    // the full mass-assignment guard.
    const selfService = ["teacher", "staff"].includes(req.user.role);
    const allowed = selfService ? STAFF_SELF_EDITABLE : STAFF_FIELDS;
    const patch = pick(req.body, allowed);
    if (patch.employeeId !== undefined) patch.employeeId = String(patch.employeeId).trim();
    if (patch.name !== undefined && isEmpty(patch.name)) {
      return res.status(400).json({ success: false, message: "Staff name cannot be empty" });
    }
    if (patch.email !== undefined && String(patch.email).trim() !== "" && !EMAIL_RE.test(String(patch.email).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    if (patch.contact !== undefined && String(patch.contact).trim() !== "" && !PHONE_RE.test(String(patch.contact).trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid phone number" });
    }

    const staff = await Staff.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    staff.set(patch);
    applyProfileDerivation(staff);
    issueCardIfReady(staff);
    await staff.save();

    if (!selfService) {
      touchStaffNotice(
        req, staff,
        "Staff profile updated",
        `Your staff profile (${staff.employeeId || "—"}) was updated by the school admin.`,
      );
    }
    res.json({ success: true, data: staff });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return res.status(409).json({
        success: false,
        message: "This Staff ID already exists in this school — Staff IDs are manual and unique per school",
      });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

// Shared Complete Profile endpoint (Person profile flow — Teacher today, Class
// Teacher / Staff later). Reachable by an admin (staff:write) completing any
// record in the school OR by the person completing their own record
// (self-service fields only, ownership enforced by restrictToOwnStaff).
// Behaviour mirrors the Student completion gate: the single profile rule must
// be satisfied before the card is auto-issued.
const completeProfile = async (req, res) => {
  try {
    const staff = await Staff.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    const patch = pick(req.body, STAFF_PROFILE_FIELDS);
    staff.set(patch);

    const missing = applyProfileDerivation(staff);
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Profile incomplete. Missing: ${missing
          .map((f) => f.replace(/([A-Z])/g, " $1").toLowerCase())
          .join(", ")}`,
      });
    }

    issueCardIfReady(staff);
    await staff.save();
    touchStaffNotice(
      req, staff,
      "Profile complete",
      `Your staff profile is complete. Your ID card (${staff.idCardNumber}) is ready.`,
      "/staff",
    );
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Admin issues/reissues a physical/printable Staff ID card. Only allowed once
// the profile is complete; re-issuing a reprint keeps the original
// idCardNumber but refreshes the issuedAt timestamp (idempotent — a completed
// profile can never mint duplicate cards).
const issueIdCard = async (req, res) => {
  try {
    const staff = await Staff.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    if (staff.profileStatus !== "complete") {
      return res.status(400).json({
        success: false,
        message: "Profile is not complete — an ID card can only be issued after the profile is completed.",
      });
    }

    assignIdCard(staff);
    staff.idCardIssuedAt = new Date();
    await staff.save();
    touchStaffNotice(
      req, staff,
      "ID card ready",
      `Your ID card (${staff.idCardNumber}) has been issued.`,
      "/staff",
    );
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Never hard-delete a staff record: employment records, attendance, marks,
// homework and audit trails reference it. Deleting ends active teacher
// assignments and marks the record inactive (Resigned), preserving history.
const deleteStaff = async (req, res) => {
  try {
    const staff = await Staff.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { $set: { status: "Resigned" } },
      { new: true },
    );
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    if (staff.role === "teacher") {
      await TeacherAssignment.updateMany(
        { schoolId: req.tenantId, staffId: staff._id, status: "active" },
        { $set: { status: "ended", endedAt: new Date() } },
      );
    }

    res.json({ success: true, message: "Staff deactivated; employment history preserved", data: staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const uploadStaffPhoto = async (req, res) => {
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
      fileName: `staff-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-")}`,
      folder: "/school-erp/staff",
      useUniqueFileName: true,
      transformation: { pre: "q-80,w-800,h-800,fo-auto" },
    });
    res.status(201).json({ success: true, data: { url: uploaded.url, fileId: uploaded.fileId } });
  } catch (err) {
    res.status(502).json({ success: false, message: err?.message || "Image upload failed" });
  }
};

module.exports = {
  createStaff,
  getStaff,
  getPendingRegistrations,
  getMyStaff,
  getStaffById,
  updateStaff,
  completeProfile,
  issueIdCard,
  deleteStaff,
  uploadStaffPhoto,
};

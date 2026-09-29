const AdmissionEnquiry = require("../models/AdmissionEnquiry");
const Student = require("../models/Student");
const { assertAcademicRefs } = require("@school-erp/shared/src/master-data");

// Mass-assignment guard: only these fields may be set from the request body.
const ENQUIRY_FIELDS = [
  "childName", "parentName", "classApplied", "contact", "email", "admissionNo",
  "section", "source", "status", "followUpDate", "notes",
];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const isDuplicateKey = (err) =>
  err && (err.code === 11000 || (err.name === "MongoServerError" && err.code === 11000));

const PHONE_RE = /^[+]?[0-9\s-]{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field-level validation run before any side-effect (shell creation) so a bad
// payload never leaves a half-written state behind.
const validateEnquiryPayload = (body) => {
  const childName = String(body.childName || "").trim();
  const parentName = String(body.parentName || "").trim();
  const classApplied = String(body.classApplied || "").trim();
  const contact = String(body.contact || "").trim();
  const email = body.email !== undefined ? String(body.email).trim() : "";

  if (!childName) return "Child name is required";
  if (childName.length < 2) return "Child name must be at least 2 characters";
  if (!parentName) return "Parent / guardian name is required";
  if (parentName.length < 2) return "Parent name must be at least 2 characters";
  if (!classApplied) return "Class applied is required";
  if (!contact) return "Contact is required";
  if (!PHONE_RE.test(contact)) return "Enter a valid 10-digit phone number";
  if (email && !EMAIL_RE.test(email)) return "Enter a valid email address";
  return null;
};

// One Admission ID per admitted enquiry within a school. Existing student
// records (e.g. a platform-created shell) with the same Admission ID are fine
// — the enquiry links to them rather than creating duplicates.
const assertAdmissionIdAvailable = async (schoolId, admissionNo, excludeId) => {
  if (!admissionNo) return { required: false };
  const used = await AdmissionEnquiry.findOne({
    schoolId,
    admissionNo,
    status: "Admitted",
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (used) {
    return { conflict: `Admission ID "${admissionNo}" is already assigned to another admitted enquiry` };
  }
  return { required: false };
};

const validateAdmission = async ({ schoolId, status, admissionNo, id }) => {
  if (status !== "Admitted") return {};
  const admId = String(admissionNo || "").trim();
  if (!admId) {
    return { error: { status: 400, message: "Admission ID is required when an enquiry is Admitted" } };
  }
  const { conflict } = await assertAdmissionIdAvailable(schoolId, admId, id);
  if (conflict) return { error: { status: 409, message: conflict } };
  return { admissionNo: admId };
};

// ---------------------------------------------------------------------------
// Admission-confirmed shells. Confirming an admission ("Admission Confirmed")
// materialises the pending Student shell that the pending-registration queue
// and the Register-User flow anchor on. The Admission ID stays MANUAL: it is
// whatever the counsellor typed into the enquiry — no generator, no counter.
//
// A repeated confirmation for the same configured Admission ID is idempotent
// (the existing shell is reused, never duplicated) and a legacy Admitted
// enquiry that happens to lack a shell is repaired here.
// ---------------------------------------------------------------------------
const ensureStudentShell = async ({
  req,
  admissionNo,
  childName,
  parentName,
  contact,
  email,
  classApplied,
  section,
}) => {
  const existing = await Student.findOne({
    schoolId: req.tenantId,
    admissionNo,
    deletedAt: null,
  });
  if (existing) return { shell: existing, created: false };

  const data = {
    schoolId: req.tenantId,
    admissionNo,
    userId: null,
    name: String(childName || "").trim() || "Pending Student",
  };
  // Map the enquiry's academic picks onto the shell. The refs gate is a soft
  // integrity check (fail-open when academic-service is unreachable), so a
  // confirmation is never blocked by a typo'd class/section — non-master
  // values simply leave those fields empty to be filled during onboarding.
  try {
    await assertAcademicRefs({ req, values: { class: classApplied, section } });
    if (classApplied && String(classApplied).trim()) data.class = String(classApplied).trim();
    if (section && String(section).trim()) data.section = String(section).trim();
  } catch {
    // keep the shell minimal; class/section are completed during onboarding.
  }
  if (parentName && String(parentName).trim()) data.parentName = String(parentName).trim();
  if (contact && String(contact).trim()) data.parentContact = String(contact).trim();
  if (email && String(email).trim()) data.parentEmail = String(email).trim();

  let shell;
  try {
    shell = await Student.create(data);
  } catch (err) {
    // Race: a concurrent confirmation created the same Admission ID between
    // our findOne and create — the unique index won, so reuse that shell and
    // keep the confirmation idempotent instead of failing the request.
    if (isDuplicateKey(err)) {
      const winner = await Student.findOne({
        schoolId: req.tenantId,
        admissionNo,
        deletedAt: null,
      });
      if (winner) return { shell: winner, created: false };
    }
    throw err;
  }
  return { shell, created: true };
};

// Confirms an admission: validates the Admission ID, materialises the pending
// Student shell and creates the enquiry. If anything fails after a fresh shell
// was created, the shell is rolled back so a half-admitted state is never
// persisted.
const createEnquiry = async (req, res) => {
  try {
    const fieldError = validateEnquiryPayload(req.body);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }
    const { schoolId, status, admissionNo, id } = {
      schoolId: req.tenantId,
      ...req.body,
      id: undefined,
    };
    const check = await validateAdmission({ schoolId, status, admissionNo, id });
    if (check.error) {
      return res.status(check.error.status).json({ success: false, message: check.error.message });
    }
    const finalAdmissionNo =
      check.admissionNo !== undefined ? check.admissionNo : req.body.admissionNo || null;

    let createdShellId = null;
    if (status === "Admitted") {
      const admitted = await ensureStudentShell({
        req,
        admissionNo: finalAdmissionNo,
        childName: req.body.childName,
        parentName: req.body.parentName,
        contact: req.body.contact,
        email: req.body.email,
        classApplied: req.body.classApplied,
        section: req.body.section,
      });
      if (admitted.created) createdShellId = String(admitted.shell._id);
    }

    let enquiry;
    try {
      enquiry = await AdmissionEnquiry.create({
        ...pick(req.body, ENQUIRY_FIELDS),
        schoolId: req.tenantId,
        admissionNo: finalAdmissionNo,
      });
    } catch (err) {
      if (createdShellId) await Student.deleteOne({ _id: createdShellId }).catch(() => {});
      throw err;
    }
    res.status(201).json({ success: true, data: enquiry });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return res
        .status(409)
        .json({ success: false, message: "This Admission ID is already assigned in this school" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getEnquiries = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { schoolId: req.tenantId };
    if (status) filter.status = status;
    const data = await AdmissionEnquiry.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateEnquiry = async (req, res) => {
  try {
    const enquiry = await AdmissionEnquiry.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    const fieldError = validateEnquiryPayload({
      ...enquiry.toObject(),
      ...req.body,
    });
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const status = req.body.status !== undefined ? req.body.status : enquiry.status;
    const admissionNo =
      req.body.admissionNo !== undefined ? req.body.admissionNo : enquiry.admissionNo;
    const check = await validateAdmission({
      schoolId: req.tenantId,
      status,
      admissionNo,
      id: enquiry._id,
    });
    if (check.error) {
      return res.status(check.error.status).json({ success: false, message: check.error.message });
    }
    const finalAdmissionNo =
      check.admissionNo !== undefined ? check.admissionNo : admissionNo;

    // Confirming materialises the pending Student shell (re-confirming an
    // already-Admitted enquiry stays idempotent — the existing shell is reused).
    let createdShellId = null;
    if (status === "Admitted") {
      const admitted = await ensureStudentShell({
        req,
        admissionNo: finalAdmissionNo,
        childName: req.body.childName !== undefined ? req.body.childName : enquiry.childName,
        parentName: req.body.parentName !== undefined ? req.body.parentName : enquiry.parentName,
        contact: req.body.contact !== undefined ? req.body.contact : enquiry.contact,
        email: req.body.email !== undefined ? req.body.email : enquiry.email,
        classApplied: req.body.classApplied !== undefined ? req.body.classApplied : enquiry.classApplied,
        section: req.body.section !== undefined ? req.body.section : enquiry.section,
      });
      if (admitted.created) createdShellId = String(admitted.shell._id);
    }

    enquiry.set({
      ...pick(req.body, ENQUIRY_FIELDS),
      admissionNo: finalAdmissionNo,
    });
    try {
      await enquiry.save();
    } catch (err) {
      if (createdShellId) await Student.deleteOne({ _id: createdShellId }).catch(() => {});
      throw err;
    }
    res.json({ success: true, data: enquiry });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return res
        .status(409)
        .json({ success: false, message: "This Admission ID is already assigned in this school" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteEnquiry = async (req, res) => {
  try {
    const enquiry = await AdmissionEnquiry.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found" });
    res.json({ success: true, message: "Enquiry deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createEnquiry, getEnquiries, updateEnquiry, deleteEnquiry };

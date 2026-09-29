const express = require("express");
const multer = require("multer");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/studentController");
const {
  verifyToken,
  resolveTenant,
  requireTenant,
  requirePermission,
  restrictToOwnStudent,
  scopeClassTeacher,
} = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Own-profile lookup is self-scoped (token refId / linked children) and only
// served to student/parent accounts; the gate mirrors that intent instead of
// requiring students:read.
const gateOwnProfile = (req, res, next) => {
  if (["student", "parent"].includes(req.user.role)) return next();
  return requirePermission("students:read")(req, res, next);
};

// List gate: parents pass through to the controller's linkedStudentIds branch
// (they deliberately lack students:read); everyone else needs students:read and
// assignment scoping.
const gateStudentList = (req, res, next) => {
  if (req.user && req.user.role === "parent") return next();
  return requirePermission("students:read")(req, res, (err) => {
    if (err) return next(err);
    return scopeClassTeacher(req, res, next);
  });
};

// Single-record gate: parents pass through (restrictToOwnStudent narrows them
// to a linked child); non-parents need students:read.
const gateStudentRead = (req, res, next) => {
  if (req.user && req.user.role === "parent") return next();
  return requirePermission("students:read")(req, res, next);
};

router.post("/", requirePermission("students:write"), ctrl.createStudent);
router.get(
  "/stats/summary",
  requirePermission("students:read"),
  scopeClassTeacher,
  ctrl.bulkStats,
);
// "Current student" must be declared before the parameterized /:id route.
router.get("/me", gateOwnProfile, ctrl.getMyStudent);
router.get(
  "/counsellor/stats",
  requirePermission("students:read"),
  scopeClassTeacher,
  ctrl.counsellorStats,
);
router.get("/", gateStudentList, ctrl.getStudents);
// Pending registrations (student shells awaiting an account) is an admin
// surface: gated by users:manage so a counsellor/teacher/student can never
// enumerate un-linked student profiles. Must be declared before /:id.
router.get(
  "/pending-registrations",
  requirePermission("users:manage"),
  ctrl.getPendingRegistrations,
);
// Transfer Certificates (Phase 2) — literal prefix, must be declared before
// the parameterized /:id routes below so "transfer-certificates" is never
// parsed as an ObjectId. Issue = transfer:write, read/pdf = transfer:read.
const tcCtrl = require("../controllers/tcController");
router.post(
  "/transfer-certificates",
  requirePermission("transfer:write"),
  tcCtrl.issueTc,
);
router.get(
  "/transfer-certificates",
  requirePermission("transfer:read"),
  tcCtrl.getTcs,
);
router.get(
  "/transfer-certificates/:id",
  requirePermission("transfer:read"),
  tcCtrl.getTc,
);
router.get(
  "/transfer-certificates/:id/pdf",
  requirePermission("transfer:read"),
  tcCtrl.downloadTcPdf,
);
router.get(
  "/:id",
  gateStudentRead,
  restrictToOwnStudent((req) => req.params.id),
  ctrl.getStudentById,
);
router.put(
  "/:id",
  requirePermission("students:write"),
  restrictToOwnStudent((req) => req.params.id),
  ctrl.updateStudent,
);
router.post(
  "/:id/complete-profile",
  requirePermission("students:write"),
  restrictToOwnStudent((req) => req.params.id),
  ctrl.completeProfile,
);
router.delete(
  "/:id",
  requirePermission("students:write"),
  restrictToOwnStudent((req) => req.params.id),
  ctrl.deleteStudent,
);
// Undo a soft-delete (before the purge retention window elapses).
router.post(
  "/:id/restore",
  requirePermission("students:write"),
  ctrl.restoreStudent,
);
router.post(
  "/:id/issue-id-card",
  requirePermission("students:write"),
  restrictToOwnStudent((req) => req.params.id),
  ctrl.issueIdCard,
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("image/")) return callback(null, true);
    callback(new Error("Only image files are allowed"));
  },
});

router.post(
  "/upload-photo",
  requirePermission("students:write"),
  upload.single("photo"),
  ctrl.uploadStudentPhoto,
);

module.exports = router;

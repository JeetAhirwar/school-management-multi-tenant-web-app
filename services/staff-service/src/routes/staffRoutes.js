const express = require("express");
const router = express.Router();
const multer = require("multer");
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/staffController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, restrictToOwnStaff, authorizeRoles } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("image/")) return callback(null, true);
    callback(new Error("Only image files are allowed"));
  },
});

// Complete Profile is a shared person flow: an admin (staff:write) can complete
// any record in the school, while a Staff/Teacher/Class Teacher completes only
// their OWN record (ownership enforced by restrictToOwnStaff below).
const gateOwnOrStaffWrite = (req, res, next) => {
  if (["teacher", "staff"].includes(req.user.role)) return next();
  return requirePermission("staff:write")(req, res, next);
};

router.post("/", requirePermission("staff:write"), ctrl.createStaff);
router.get("/", requirePermission("staff:read"), ctrl.getStaff);

// Pending person registrations (Staff records awaiting an account) is an
// admin surface: gated by users:manage so a teacher/staff can never enumerate
// un-linked records. Must be declared before /:id. Optional ?role= so future
// Class Teacher / Staff tabs reuse it — Teachers today.
router.get(
  "/pending-registrations",
  requirePermission("users:manage"),
  ctrl.getPendingRegistrations,
);
// Own profile lookup for a Staff/Teacher/Class Teacher account. Must be
// declared before /:id.
router.get("/me", authorizeRoles("teacher", "staff"), ctrl.getMyStaff);

// Photo upload — a staff/teacher uploads their own; admin can upload for any.
router.post(
  "/upload-photo",
  authorizeRoles("teacher", "staff"),
  photoUpload.single("photo"),
  ctrl.uploadStaffPhoto,
);

router.get("/:id", requirePermission("staff:read"), restrictToOwnStaff((req) => req.params.id), ctrl.getStaffById);
// Self-service PUT: a Staff/Teacher/Class Teacher may edit ONLY their own record
// (restrictToOwnStaff) and ONLY self-service fields (STAFF_SELF_EDITABLE in
// updateStaff); admins keep the full mass-assignment guard.
router.put("/:id", gateOwnOrStaffWrite, restrictToOwnStaff((req) => req.params.id), ctrl.updateStaff);
router.put("/:id/complete-profile", gateOwnOrStaffWrite, restrictToOwnStaff((req) => req.params.id), ctrl.completeProfile);
// Manual Issue / Reissue stays an admin-only fallback operation.
router.post("/:id/issue-id-card", requirePermission("staff:write"), ctrl.issueIdCard);
router.delete("/:id", requirePermission("staff:write"), restrictToOwnStaff((req) => req.params.id), ctrl.deleteStaff);

module.exports = router;

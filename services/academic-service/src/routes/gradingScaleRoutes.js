const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/gradingScaleController");
const {
  verifyToken,
  resolveTenant,
  requireTenant,
  requirePermission,
} = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Readable by anyone who can see grades; writable by exam admins.
router.get("/", requirePermission("exams:read"), ctrl.listScales);
router.get("/active", requirePermission("exams:read"), ctrl.getActiveScale);
router.post("/", requirePermission("exams:write"), ctrl.createScale);
router.patch("/:id", requirePermission("exams:write"), ctrl.updateScale);
router.post("/:id/activate", requirePermission("exams:write"), ctrl.activateScale);
router.delete("/:id", requirePermission("exams:write"), ctrl.deleteScale);

module.exports = router;

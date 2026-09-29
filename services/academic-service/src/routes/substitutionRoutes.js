const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/substitutionController");
const {
  verifyToken,
  resolveTenant,
  requireTenant,
  requirePermission,
  scopeClassTeacher,
  guardClassBody,
} = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/", requirePermission("timetable:read"), ctrl.listSubstitutions);
router.post(
  "/",
  requirePermission("timetable:write"),
  scopeClassTeacher,
  guardClassBody(),
  ctrl.createSubstitution
);
router.patch("/:id/status", requirePermission("timetable:write"), ctrl.setStatus);
router.delete("/:id", requirePermission("timetable:write"), ctrl.deleteSubstitution);

module.exports = router;

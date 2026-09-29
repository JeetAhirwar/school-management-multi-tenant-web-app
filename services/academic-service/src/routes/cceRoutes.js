const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/cceController");
const {
  verifyToken,
  resolveTenant,
  requireTenant,
  requirePermission,
  scopeStudentQuery,
} = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// /api/cce/co-scholastic — students read their own row (scopeStudentQuery
// pins studentId to the caller); staff need exams:read.
router.get(
  "/co-scholastic",
  requirePermission("exams:read"),
  scopeStudentQuery,
  ctrl.getCoScholastic,
);
router.put("/co-scholastic", requirePermission("exams:write"), ctrl.upsertCoScholastic);

module.exports = router;

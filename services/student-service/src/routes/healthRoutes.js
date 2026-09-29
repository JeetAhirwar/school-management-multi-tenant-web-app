const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/healthController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeClassTeacher } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Health-record gates (Phase 2): medical data now requires the dedicated
// health:read/health:write permissions instead of the generic students:*
// bundle — counsellors (students:*) lose access to medical data, teachers
// keep read-only where their role grants health:read. Students own-only.
const gateHealthRead = (req, res, next) => {
  const perm = req.user?.role === "student" ? "profile:read" : "health:read";
  return requirePermission(perm)(req, res, next);
};
const gateHealthWrite = (req, res, next) => {
  const perm = req.user?.role === "student" ? "profile:update" : "health:write";
  return requirePermission(perm)(req, res, next);
};

router.get("/", gateHealthRead, scopeClassTeacher, ctrl.getHealth);
router.put("/", gateHealthWrite, scopeClassTeacher, ctrl.upsertHealth);

module.exports = router;

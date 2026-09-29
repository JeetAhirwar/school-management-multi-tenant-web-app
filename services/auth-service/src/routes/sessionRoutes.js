const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);

const ctrl = require("../controllers/academicSessionController");
const { verifyToken, resolveTenant, requirePermission } = require("../middleware/auth");
const { requireSchoolActive } = require("@school-erp/shared/src/middleware/requireSchoolActive");

// Sessions are tenant-scoped. Regular users inherit the tenant from the token;
// platform (super_admin) must select a school via X-School-Id.
const requireTenant = async (req, res, next) => {
  if (!req.tenantId) {
    return res.status(400).json({ success: false, message: "No school context (X-School-Id required)" });
  }
  return requireSchoolActive(req, res, next);
};

// /api/auth/sessions
router.use(verifyToken, resolveTenant, requireTenant);

router.get("/", requirePermission("sessions:read"), ctrl.listSessions);
router.get("/current", requirePermission("sessions:read"), ctrl.getCurrentSession);
router.get("/:id", requirePermission("sessions:read"), ctrl.getSessionById);
router.post("/", requirePermission("sessions:write"), ctrl.createSession);
router.patch("/:id", requirePermission("sessions:write"), ctrl.updateSession);
router.post("/:id/activate", requirePermission("sessions:write"), ctrl.activateSession);
router.post("/:id/end", requirePermission("sessions:write"), ctrl.endSession);
router.delete("/:id", requirePermission("sessions:write"), ctrl.deleteSession);

module.exports = router;
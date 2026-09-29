const express = require("express");
const router = express.Router();
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
const ctrl = require("../controllers/examMasterController");

// /api/exam-masters/:kind/...  (kind: exam-types | classes | sections | subjects | time-slots | rooms)
router.use(verifyToken, resolveTenant, requireTenant);

router.get("/:kind", requirePermission("exams:read"), ctrl.list);
router.get("/:kind/:id", requirePermission("exams:read"), ctrl.getById);
router.post("/validate-refs", requirePermission("exams:read"), ctrl.validateRefs);
router.post("/:kind", requirePermission("exams:write"), ctrl.create);
router.patch("/:kind/:id/deactivate", requirePermission("exams:write"), ctrl.deactivate);
router.patch("/:kind/:id/restore", requirePermission("exams:write"), ctrl.restore);
router.patch("/:kind/:id", requirePermission("exams:write"), ctrl.update);

module.exports = router;
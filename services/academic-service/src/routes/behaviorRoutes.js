const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/behaviorController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeClassTeacher, scopeStudentQuery } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Role-aware read gate (mirrors documentRoutes.gateDocRead): students read
// only their OWN conduct history via conduct:read; admins and teachers keep
// the broad students:read listing.
const gateBehaviorRead = (req, res, next) => {
  const perm = req.user?.role === "student" ? "conduct:read" : "students:read";
  return requirePermission(perm)(req, res, next);
};
const gateBehaviorWrite = (req, res, next) => {
  return requirePermission("students:write")(req, res, next);
};

router.post("/", gateBehaviorWrite, scopeClassTeacher, ctrl.createRecord);
router.get("/", gateBehaviorRead, scopeStudentQuery, scopeClassTeacher, ctrl.listRecords);
router.get("/:id", gateBehaviorRead, ctrl.getRecord);
router.put("/:id", gateBehaviorWrite, scopeClassTeacher, ctrl.updateRecord);
router.delete("/:id", gateBehaviorWrite, ctrl.deleteRecord);

module.exports = router;

const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/achievementController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeClassTeacher, scopeStudentQuery } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Role-aware read gate (mirrors documentRoutes.gateDocRead): students read
// only their OWN achievements via achievements:read; admins and teachers keep
// the broad students:read listing.
const gateAchievementRead = (req, res, next) => {
  const perm = req.user?.role === "student" ? "achievements:read" : "students:read";
  return requirePermission(perm)(req, res, next);
};
const gateAchievementWrite = (req, res, next) => {
  return requirePermission("students:write")(req, res, next);
};

router.post("/", gateAchievementWrite, scopeClassTeacher, ctrl.createAchievement);
router.get("/", gateAchievementRead, scopeStudentQuery, scopeClassTeacher, ctrl.listAchievements);
router.get("/:id", gateAchievementRead, ctrl.getAchievement);
router.put("/:id", gateAchievementWrite, scopeClassTeacher, ctrl.updateAchievement);
router.delete("/:id", gateAchievementWrite, ctrl.deleteAchievement);

module.exports = router;

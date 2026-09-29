const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/homeworkController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeStudentSchedule, scopeClassTeacher, guardClassBody } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("homework:write"), scopeClassTeacher, guardClassBody(), ctrl.createHomework);
router.get("/", requirePermission("homework:read"), scopeStudentSchedule({ section: true }), scopeClassTeacher, ctrl.getHomework);
router.put("/:id", requirePermission("homework:write"), scopeClassTeacher, guardClassBody(), ctrl.updateHomework);
router.delete("/:id", requirePermission("homework:write"), scopeClassTeacher, ctrl.deleteHomework);

module.exports = router;

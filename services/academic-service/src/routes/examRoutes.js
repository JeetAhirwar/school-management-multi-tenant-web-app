const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/examController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeStudentSchedule, scopeClassTeacher } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("exams:write"), ctrl.createExam);
router.get("/", requirePermission("exams:read"), scopeStudentSchedule(), scopeClassTeacher, ctrl.getExams);
// Must precede the "/:id" routes so "term-rollup" is never parsed as an id.
router.get("/term-rollup", requirePermission("exams:read"), scopeClassTeacher, ctrl.getTermRollup);
router.put("/:id", requirePermission("exams:write"), ctrl.updateExam);
router.delete("/:id", requirePermission("exams:write"), ctrl.deleteExam);
router.patch("/:id/status", requirePermission("exams:write"), ctrl.updateExamStatus);

module.exports = router;
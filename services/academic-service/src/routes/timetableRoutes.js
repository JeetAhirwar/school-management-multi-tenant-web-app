const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/timetableController");
const generateCtrl = require("../controllers/timetableGenerateController");
const substitutionRoutes = require("./substitutionRoutes");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeStudentSchedule, scopeClassTeacher, guardClassBody } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Substitutions live under /api/timetable/substitutions — mounted before the
// generic "/:id" DELETE so "substitutions" is never parsed as a period id.
router.use("/substitutions", substitutionRoutes);

router.post("/", requirePermission("timetable:write"), scopeClassTeacher, guardClassBody(), ctrl.upsertTimetable);
router.post("/generate", requirePermission("timetable:write"), scopeClassTeacher, guardClassBody(), generateCtrl.generateTimetable);
router.get("/", requirePermission("timetable:read"), scopeStudentSchedule({ section: true }), scopeClassTeacher, ctrl.getTimetable);
router.delete("/:id", requirePermission("timetable:write"), scopeClassTeacher, ctrl.deleteTimetable);

module.exports = router;

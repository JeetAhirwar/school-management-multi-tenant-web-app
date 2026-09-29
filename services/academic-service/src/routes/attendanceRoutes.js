const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/attendanceController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeStudentQuery, scopeClassTeacher, guardClassBody } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/mark", requirePermission("attendance:mark"), scopeClassTeacher, guardClassBody("records"), ctrl.markAttendance);
// scopeStudentQuery on the report too: a student (attendance:read) must only
// ever aggregate their OWN records, never class/school-wide statistics.
router.get("/report", requirePermission("attendance:read"), scopeStudentQuery, scopeClassTeacher, ctrl.getAttendanceReport);
router.get("/", requirePermission("attendance:read"), scopeStudentQuery, scopeClassTeacher, ctrl.getAttendance);

module.exports = router;

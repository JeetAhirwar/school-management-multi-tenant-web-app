const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/staffAttendanceController");
const {
  verifyToken,
  resolveTenant,
  requireTenant,
  requirePermission,
  authorizeRoles,
} = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant, authorizeRoles("school_admin", "teacher", "staff"));

router.get("/me/today", ctrl.getMyToday);
router.get("/today", requirePermission("attendance:read"), ctrl.getTodayAll);
router.get("/monthly", requirePermission("attendance:read"), ctrl.getMonthlySummary);
router.post("/", requirePermission("attendance:mark"), ctrl.markAttendance);
router.patch("/:id/correct", requirePermission("attendance:mark"), ctrl.correctAttendance);
router.get("/", ctrl.getAttendance);

module.exports = router;

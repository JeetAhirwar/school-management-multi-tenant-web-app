const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/leaveController");
const { verifyToken, resolveTenant, requireTenant, authorizeRoles, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", authorizeRoles("school_admin", "teacher", "staff", "student"), requirePermission("leaves:apply"), ctrl.applyLeave);
router.get("/", authorizeRoles("school_admin", "teacher", "staff", "student"), requirePermission("leaves:apply"), ctrl.getLeaves);
router.get("/balance", authorizeRoles("school_admin", "teacher", "staff", "student"), requirePermission("leaves:apply"), ctrl.getLeaveBalance);
router.patch("/:id/status", requirePermission("leaves:approve"), ctrl.updateLeaveStatus);

module.exports = router;

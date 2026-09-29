const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/teacherAssignmentController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Self-service: any authenticated teacher/staff reads their own assignments.
router.get("/me", requirePermission("staff:read"), ctrl.listMyAssignments);

// Admin management (CRUD + soft-end). `staff:read` lets a school admin view
// everyone; `staff:write` gates mutations. Role guards in the controller keep
// staff/teachers from reading or editing other people's records.
router.get("/", requirePermission("staff:read"), ctrl.listAssignments);
router.get("/:id", requirePermission("staff:read"), ctrl.getAssignmentById);
router.post("/", requirePermission("staff:write"), ctrl.createAssignment);
router.patch("/:id", requirePermission("staff:write"), ctrl.updateAssignment);
router.post("/:id/end", requirePermission("staff:write"), ctrl.endAssignment);
router.post("/:id/start", requirePermission("staff:write"), ctrl.startAssignment);
router.delete("/:id", requirePermission("staff:write"), ctrl.endAssignment);

module.exports = router;
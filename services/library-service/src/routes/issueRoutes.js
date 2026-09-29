const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/issueController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeStudentParam } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/send-overdue-notifications", requirePermission("library:notify"), ctrl.sendOverdueNotifications);
router.post("/issue", requirePermission("library:manage"), ctrl.issueBook);
router.patch("/:id/return", requirePermission("library:manage"), ctrl.returnBook);
router.get("/", requirePermission("library:read"), scopeStudentParam("borrowerId"), ctrl.getIssues);

module.exports = router;

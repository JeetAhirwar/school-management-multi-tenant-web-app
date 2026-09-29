const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/notificationController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant);

router.post("/push", requireTenant, requirePermission("notices:publish"), ctrl.pushNotifications);
router.get("/", requireTenant, ctrl.getNotifications);
router.get("/stream", requireTenant, ctrl.streamNotifications);
router.get("/unread-count", requireTenant, ctrl.getUnreadCount);
router.patch("/read-all", requireTenant, ctrl.markAllRead);
router.patch("/:id/read", requireTenant, ctrl.markAsRead);

module.exports = router;
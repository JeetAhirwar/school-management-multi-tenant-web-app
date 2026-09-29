const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/messageController");
const { verifyToken, resolveTenant, requireTenant, authorizeRoles } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);
// No new permission strings in Phase 10: thread membership is derived per
// request (parent of the child / class teacher / staff), so a role gate is
// the only static requirement.
router.use(authorizeRoles("parent", "teacher", "school_admin", "super_admin"));

router.get("/", ctrl.listThreads);
router.post("/", ctrl.createThread);
router.get("/:id", ctrl.getThread);
router.post("/:id/reply", ctrl.replyToThread);

module.exports = router;

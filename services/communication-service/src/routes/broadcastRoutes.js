const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/broadcastController");
const { verifyToken, resolveTenant, requireTenant, authorizeRoles } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);
// Broadcasts are school-admin-only. No new permission strings in Phase 10.
router.use(authorizeRoles("school_admin", "super_admin"));

router.post("/sms", ctrl.sendSms);
router.post("/email", ctrl.sendEmail);
router.get("/logs", ctrl.listLogs);

module.exports = router;
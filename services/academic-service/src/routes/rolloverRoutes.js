const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/rolloverController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/prepare", requirePermission("rollover:read"), ctrl.prepare);

module.exports = router;
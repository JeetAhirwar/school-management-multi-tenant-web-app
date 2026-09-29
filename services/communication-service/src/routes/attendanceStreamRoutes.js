const express = require("express");
const router = express.Router();
const { verifyToken, resolveTenant, requireTenant } = require("../middleware/auth");
const ctrl = require("../controllers/attendanceStream");

router.use(verifyToken, resolveTenant);

router.get("/stream", requireTenant, ctrl.streamAttendance);

module.exports = router;

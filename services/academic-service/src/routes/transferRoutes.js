const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/transferController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("transfer:write"), ctrl.create);
router.get("/history", requirePermission("transfer:read"), ctrl.history);

module.exports = router;
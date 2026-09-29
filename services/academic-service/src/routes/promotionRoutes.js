const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/promotionController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeClassTeacher } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/preview", requirePermission("promotion:read"), scopeClassTeacher, ctrl.preview);
router.get("/history", requirePermission("promotion:read"), scopeClassTeacher, ctrl.history);
router.post("/", requirePermission("promotion:write"), ctrl.commit);

module.exports = router;
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/studyMaterialController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/", requirePermission("homework:read"), ctrl.getMaterials);
router.post("/", requirePermission("homework:write"), ctrl.createMaterial);
router.delete("/:id", requirePermission("homework:write"), ctrl.deleteMaterial);

module.exports = router;

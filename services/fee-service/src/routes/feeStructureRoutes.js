const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/feeStructureController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("fees:structure"), ctrl.createStructure);
router.get("/", requirePermission("fees:read"), ctrl.getStructures);
router.put("/:id", requirePermission("fees:structure"), ctrl.updateStructure);
router.patch("/:id", requirePermission("fees:structure"), ctrl.toggleActive);
router.delete("/:id", requirePermission("fees:structure"), ctrl.deleteStructure);

module.exports = router;

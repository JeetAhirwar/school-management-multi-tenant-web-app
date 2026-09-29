const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/concessionController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/", requirePermission("fees:read"), ctrl.getConcessions);
router.post("/", requirePermission("fees:structure"), ctrl.createConcession);
router.patch("/:id/approve", requirePermission("fees:structure"), ctrl.approveConcession);
router.patch("/:id/reject", requirePermission("fees:structure"), ctrl.rejectConcession);
router.delete("/:id", requirePermission("fees:structure"), ctrl.removeConcession);

module.exports = router;

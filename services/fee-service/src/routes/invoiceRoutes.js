const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/invoiceController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeStudentQuery } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/generate/preview", requirePermission("fees:collect"), ctrl.generatePreview);
router.post("/generate/confirm", requirePermission("fees:collect"), ctrl.confirmGenerate);

router.post("/", requirePermission("fees:collect"), ctrl.createInvoice);
router.get("/", requirePermission("fees:read"), scopeStudentQuery, ctrl.getInvoices);
router.get("/:id/pdf", requirePermission("fees:read"), ctrl.downloadInvoicePdf);

module.exports = router;

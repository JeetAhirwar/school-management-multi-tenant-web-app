const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/paymentController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeStudentQuery } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("fees:collect"), ctrl.recordPayment);
router.post("/:id/clearance", requirePermission("fees:collect"), ctrl.setChequeClearance);
router.get("/receipt/:receiptNo", requirePermission("fees:read"), ctrl.getReceipt);
router.get("/receipt/:receiptNo/pdf", requirePermission("fees:read"), ctrl.getReceiptPdf);
router.get("/reports", requirePermission("fees:reports"), ctrl.getFeeReports);
router.get("/reconciliation", requirePermission("fees:reports"), ctrl.getReconciliation);
router.get("/", requirePermission("fees:read"), scopeStudentQuery, ctrl.getPayments);

module.exports = router;

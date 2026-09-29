const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/paymentOrderController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// List payment orders (staff: all/any student; student: own only via controller filter)
router.get("/", requirePermission("fees:read"), ctrl.getOrders);

// Create an order against an unpaid invoice (accounts or student, own invoice).
router.post("/", requirePermission("fees:read"), ctrl.createOrder);

// Attempt provider checkout. Returns 503 when provider not configured.
router.post("/:id/initiate", requirePermission("fees:read"), ctrl.initiateOrder);

// Office verification queue for manual-mode orders (UPI/QR/bank/manual).
// Collection-desk permission: this endpoint records real money as received.
router.post("/:id/manual-confirm", requirePermission("fees:collect"), ctrl.manualConfirmOrder);

// Master cancel (restore order to cancelled so it can be recreated).
router.patch("/:id/cancel", requirePermission("fees:read"), ctrl.cancelOrder);

// Client-side confirmation fallback; guarded by provider payment-signature
// HMAC (a forged confirm is cryptographically impossible) and fees:read.
router.post("/:id/confirm", requirePermission("fees:read"), ctrl.confirmOrder);

module.exports = router;
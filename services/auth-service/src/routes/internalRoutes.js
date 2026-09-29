const express = require("express");
const router = express.Router();
const {
  internalGuard,
  getPaymentGateway,
  subscriptionPaid,
  deactivateStudentUser,
  purgeStudentUser,
  sendInternalEmail,
} = require("../controllers/internalController");
const { getSessionWindow } = require("../controllers/academicSessionController");

router.use(internalGuard);

// Payment engine fetches the decryptable school gateway config.
router.get("/payment-gateway", getPaymentGateway);

// Academic service resolves a session label to its calendar window
// (report-card attendance scoping).
router.get("/sessions/window", getSessionWindow);

// Payment engine notifies that a subscription_upgrade order has been paid.
router.post("/subscription-paid", subscriptionPaid);

// Student delete cascade (student-service): deactivate / purge the linked
// student login when a Student row is soft-deleted / hard-purged.
router.post("/users/deactivate-by-student", deactivateStudentUser);
router.post("/users/purge-by-student", purgeStudentUser);

// Transactional email relay (fee-service reminders, etc.) — SMTP lives here.
router.post("/send-email", sendInternalEmail);

module.exports = router;
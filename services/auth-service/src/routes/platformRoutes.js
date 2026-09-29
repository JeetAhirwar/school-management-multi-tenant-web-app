const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/platformController");
const { verifyToken, authorizeRoles } = require("../middleware/auth");

// Platform-owner only. All billing + subscription operations are global to the
// platform and never fall under a school tenant scope.
router.use(verifyToken, authorizeRoles("super_admin"));

// Analytics
router.get("/analytics", ctrl.getPlatformAnalytics);

// Audit trail (read-only surface for the append-oriented store)
router.get("/audit-logs", ctrl.listAuditLogs);

// Platform users (list / 360)
router.get("/users", ctrl.listPlatformUsers);
router.get("/users/:id", ctrl.getUser360);

// Schools management (list / 360 / lifecycle / onboarding)
router.get("/schools", ctrl.listPlatformSchools);
router.get("/schools/:id", ctrl.getSchool360);
router.patch("/schools/:id/status", ctrl.updateSchoolStatus);
router.patch("/schools/:id/soft-delete", ctrl.softDeleteSchool);
router.patch("/schools/:id/restore", ctrl.restoreSchool);
router.delete("/schools/:id", ctrl.hardDeleteSchool);
router.patch("/schools/:id/onboarding", ctrl.updateSchoolOnboarding);
router.patch("/schools/:id", ctrl.updateSchoolProfile);
router.post("/schools/:id/welcome-email", ctrl.sendSchoolWelcomeEmail);

// Plans
router.get("/plans", ctrl.listPlans);
router.get("/plans/:id", ctrl.getPlan);
router.post("/plans", ctrl.createPlan);
router.patch("/plans/:id", ctrl.updatePlan);
router.delete("/plans/:id", ctrl.deletePlan);

// Subscriptions
router.get("/subscriptions", ctrl.listSubscriptions);
router.get("/subscriptions/:id", ctrl.getSubscription);
router.post("/subscriptions", ctrl.createSubscription);
router.patch("/subscriptions/:id", ctrl.updateSubscription);

// Billing / invoices
router.get("/invoices", ctrl.listInvoices);
router.get("/invoices/:id", ctrl.getInvoice);
router.post("/invoices/generate", ctrl.generateInvoice);
router.patch("/invoices/:id", ctrl.updateInvoice);

// Reports (live, generated from real data)
router.get("/reports", ctrl.listReports);
router.get("/reports/:type", ctrl.generateReport);

// Platform settings
router.get("/settings", ctrl.getPlatformSettings);
router.patch("/settings", ctrl.updatePlatformSettings);

// Reference data (boards, cities, states, recognition authorities)
router.get("/reference-data/:category", ctrl.listReferenceData);
router.post("/reference-data/:category", ctrl.addReferenceData);

module.exports = router;
const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/payrollController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/generate-all", requirePermission("payroll:admin"), ctrl.generateAllPayroll);
router.post("/", requirePermission("payroll:admin"), ctrl.generatePayroll);
router.get("/", requirePermission("payroll:view"), ctrl.getPayroll);
router.patch("/:id", requirePermission("payroll:admin"), ctrl.updatePayroll);
router.patch("/:id/pay", requirePermission("payroll:admin"), ctrl.markPaid);

module.exports = router;

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/reportController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/trial-balance", requirePermission("accounting:read"), ctrl.getTrialBalance);
router.get("/income-expense", requirePermission("accounting:read"), ctrl.getIncomeExpense);
router.get("/balance-sheet", requirePermission("accounting:read"), ctrl.getBalanceSheet);

module.exports = router;

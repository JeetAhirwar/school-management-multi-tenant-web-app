const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/accountController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/", requirePermission("accounting:read"), ctrl.getAccounts);
router.post("/", requirePermission("accounting:journal"), ctrl.createAccount);
router.patch("/:id", requirePermission("accounting:journal"), ctrl.updateAccount);
router.delete("/:id", requirePermission("accounting:journal"), ctrl.deleteAccount);

module.exports = router;

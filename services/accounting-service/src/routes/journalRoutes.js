const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/journalController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/", requirePermission("accounting:read"), ctrl.getJournal);
router.post("/", requirePermission("accounting:journal"), ctrl.createJournal);
router.delete("/:id", requirePermission("accounting:journal"), ctrl.deleteJournal);

module.exports = router;

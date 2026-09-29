const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/syllabusController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.get("/", requirePermission("homework:read"), ctrl.getSyllabus);
router.post("/", requirePermission("homework:write"), ctrl.createSyllabus);
router.patch("/:id", requirePermission("homework:write"), ctrl.updateSyllabus);
router.delete("/:id", requirePermission("homework:write"), ctrl.deleteSyllabus);

module.exports = router;

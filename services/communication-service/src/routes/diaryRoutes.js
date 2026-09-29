const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
const ctrl = require("../controllers/diaryController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

// Deliberately reuses the existing notice permissions (no new permission
// strings in Phase 10): teachers/admins who may publish notices may publish
// diary entries, anyone who may read notices may read the diary.
router.post("/", requirePermission("notices:publish"), ctrl.createDiary);
router.get("/", requirePermission("notices:read"), ctrl.listDiary);
router.put("/:id", requirePermission("notices:publish"), ctrl.updateDiary);
router.delete("/:id", requirePermission("notices:publish"), ctrl.deleteDiary);

module.exports = router;

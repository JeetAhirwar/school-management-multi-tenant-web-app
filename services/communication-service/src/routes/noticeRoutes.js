const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/noticeController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

router.post("/", requirePermission("notices:publish"), ctrl.createNotice);
router.get("/", requirePermission("notices:read"), ctrl.getNotices);
router.put("/:id", requirePermission("notices:publish"), ctrl.updateNotice);
router.delete("/:id", requirePermission("notices:publish"), ctrl.deleteNotice);

module.exports = router;

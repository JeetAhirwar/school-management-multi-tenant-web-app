const express = require("express");
const multer = require("multer");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/eventController");
const { verifyToken, resolveTenant, requireTenant, requirePermission } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("image/")) return callback(null, true);
    callback(new Error("Only image files are allowed"));
  },
});

router.post("/upload-image", requirePermission("events:publish"), upload.single("image"), ctrl.uploadEventImage);
router.post("/", requirePermission("events:publish"), ctrl.createEvent);
router.get("/", requirePermission("events:read"), ctrl.getEvents);
router.put("/:id", requirePermission("events:publish"), ctrl.updateEvent);
router.delete("/:id", requirePermission("events:publish"), ctrl.deleteEvent);

module.exports = router;

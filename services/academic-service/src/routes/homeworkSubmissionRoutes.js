const express = require("express");
const multer = require("multer");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/homeworkSubmissionController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeClassTeacher } = require("../middleware/auth");

// Homework attachments: JPG, JPEG, PNG, PDF, DOCX, PPTX up to 10 MB — mirrors
// the document upload ceiling so the limits stay consistent across the product.
const HOMEWORK_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (HOMEWORK_MIME_TYPES.has(file.mimetype)) return callback(null, true);
    callback(
      new Error(
        "Only JPG, JPEG, PNG, PDF, DOCX and PPTX files are allowed",
      ),
    );
  },
});

// Multer reports size/type failures through the callback; turn them into a
// clean JSON response instead of a generic 500 from the global error handler.
const runUpload = (handler) => (req, res, next) => {
  handler(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, message: "File too large (max 10 MB)" });
    }
    return res.status(400).json({ success: false, message: err.message || "Invalid file" });
  });
};

router.use(verifyToken, resolveTenant, requireTenant);

// Teacher: list submissions for assigned class/section (?homeworkId= or ?class=&section=)
router.get("/class/list", requirePermission("homework:read"), scopeClassTeacher, ctrl.listSubmissionsForClass);

// Student: view own submissions (optionally scoped to one homework via ?homeworkId=)
router.get("/", requirePermission("homework:read"), ctrl.getMySubmissions);

// Student: submit their homework. Subject to class/section + ownership checks.
// Accepts JSON { content, attachments } or multipart with an optional "file".
router.post("/:homeworkId", requirePermission("homework:read"), runUpload(upload.single("file")), ctrl.submitHomework);

// Student: view own submission for a specific homework.
router.get("/:homeworkId", requirePermission("homework:read"), ctrl.getMySubmissions);

// Teacher: review (feedback + marks) a submission in their class/section.
router.patch("/review/:id", requirePermission("homework:write"), scopeClassTeacher, ctrl.reviewSubmission);

module.exports = router;

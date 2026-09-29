const express = require("express");
const multer = require("multer");
const router = express.Router();
const { validateObjectIdParam } = require("@school-erp/shared/src/middleware/objectId");
router.param("id", validateObjectIdParam);
router.param("homeworkId", validateObjectIdParam);
const ctrl = require("../controllers/documentController");
const { verifyToken, resolveTenant, requireTenant, requirePermission, scopeClassTeacher } = require("../middleware/auth");

router.use(verifyToken, resolveTenant, requireTenant);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ok = file.mimetype.startsWith("image/") ||
      ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.mimetype);
    if (ok) return callback(null, true);
    callback(new Error("Only images, PDF and Word documents are allowed"));
  },
});

// Role-aware gate: students use profile:update (own documents), other roles use
// students:write (may upload for any student).
const gateDocWrite = (req, res, next) => {
  const perm = req.user?.role === "student" ? "profile:update" : "students:write";
  return requirePermission(perm)(req, res, next);
};
const gateDocRead = (req, res, next) => {
  const perm = req.user?.role === "student" ? "profile:read" : "students:read";
  return requirePermission(perm)(req, res, next);
};

// Staff/accounts: upload for any student. Students: upload their own (studentId
// ignored, derived from token).
router.post("/", gateDocWrite, upload.single("file"), ctrl.uploadDocument);

// List: students own-only; staff any/filtered (teachers scoped to their classes).
router.get("/", gateDocRead, scopeClassTeacher, ctrl.getDocuments);

// Delete: students own-only; staff any in-tenant.
router.delete("/:id", gateDocWrite, ctrl.deleteDocument);

module.exports = router;
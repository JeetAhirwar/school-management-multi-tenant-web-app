const StudentDocument = require("../models/StudentDocument");
const Student = require("../models/Student");
const imagekit = require("@school-erp/shared/src/config/imagekit");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { assertAllowedUpload } = require("@school-erp/shared/src/utils/uploads");

const sanitizeFileName = (name = "") =>
  name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);

// Uploads a document for a student. Identity (studentId) is derived from the
// token for students; staff may upload for a studentId they provide.
const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Document file is required" });
    }
    const uploadErr = assertAllowedUpload(req.file, { allowDocs: true });
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr });
    }
    const { title, category = "other", studentId } = req.body || {};

    let targetStudentId = studentId;
    if (req.user.role === "student") {
      targetStudentId = req.user.refId;
      if (!targetStudentId) {
        return res.status(403).json({ success: false, message: "No student identity on this account" });
      }
    }
    if (!targetStudentId) {
      return res.status(400).json({ success: false, message: "studentId is required for this role" });
    }
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: "title is required" });
    }

    const imagekit = require("@school-erp/shared/src/config/imagekit");
    if (!imagekit) {
      return res.status(503).json({ success: false, message: "Image provider is not configured" });
    }
    const uploaded = await imagekit.upload({
      file: req.file.buffer.toString("base64"),
      fileName: `doc-${Date.now()}-${sanitizeFileName(req.file.originalname)}`,
      folder: "/school-erp/documents",
      useUniqueFileName: true,
    });

    const doc = await StudentDocument.create({
      schoolId: req.tenantId,
      studentId: String(targetStudentId).trim(),
      title: String(title).trim(),
      category,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      url: uploaded.url,
      fileId: uploaded.fileId,
      uploadedBy: req.user.name,
      uploadedRole: req.user.role,
    });

    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    // ImageKit SDK rejects with { help, message }; axios wraps with response.data
    const reason = err.response?.data?.help || err.help || err.message || String(err);
    if (reason === "[object Object]") {
      // extract text from the provider payload if available
      try {
        const payload = err.response?.data || err;
        return res.status(502).json({ success: false, message: payload.help || payload.message || "ImageKit upload failed" });
      } catch (_) {}
    }
    res.status(502).json({ success: false, message: reason || "ImageKit upload failed" });
  }
};

// Lists documents. Students always see only their own; staff may filter by
// studentId (and are tenant-scoped by resolveTenant). Teachers are additionally
// constrained to their assigned classes — when a studentId is provided the
// teacher's scope is verified against the student's class/section.
const getDocuments = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    if (req.user.role === "student") {
      filter.studentId = req.user.refId;
    } else if (req.query.studentId) {
      // For teachers, verify the student belongs to an assigned class/section.
      if (req.user.role === "teacher" && req.teacherScope) {
        const student = await Student.findOne({
          schoolId: req.tenantId,
          $or: [
            { admissionNo: req.query.studentId },
            { _id: req.query.studentId },
          ],
        }).lean();
        if (!student || !req.teacherScope.has(student.class, student.section)) {
          return res.status(403).json({ success: false, message: "Access denied — student is not in your assigned classes" });
        }
      }
      filter.studentId = req.query.studentId;
    }
    if (req.query.category) filter.category = req.query.category;

    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      StudentDocument.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      StudentDocument.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Deletes a document. Students may only delete their own; staff may delete any
// in-tenant document.
const deleteDocument = async (req, res) => {
  try {
    const filter = { _id: req.params.id, schoolId: req.tenantId };
    if (req.user.role === "student") filter.studentId = req.user.refId;

    const doc = await StudentDocument.findOneAndDelete(filter);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    // Best-effort removal from the storage provider. Ignore failures so the DB
    // record can still be removed.
    try {
      if (doc.fileId && imagekit) await imagekit.deleteFile(doc.fileId);
    } catch (err) {
      console.error("[imagekit delete skipped]", err.message);
    }

    res.json({ success: true, message: "Document deleted", data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { uploadDocument, getDocuments, deleteDocument };
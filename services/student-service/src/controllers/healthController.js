const StudentHealthRecord = require("../models/StudentHealthRecord");

// Fields that may be written via the public upsert. schoolId / _id / studentId
// are server-owned (filter keys) and must never come from the request body.
const HEALTH_WRITABLE_FIELDS = [
  "allergies",
  "chronicConditions",
  "immunizations",
  "medications",
  "bloodGroup",
  "heightCm",
  "weightKg",
  "visionNotes",
  "hearingNotes",
  "emergencyMedicalContact",
  "emergencyMedicalPhone",
  "notes",
];

const pickHealthFields = (body) =>
  Object.fromEntries(
    Object.entries(body).filter(([key]) => HEALTH_WRITABLE_FIELDS.includes(key)),
  );

const resolveStudentIdForRequest = (req) => {
  // Students may only ever touch their own record (IDOR fix).
  if (req.user.role === "student") return String(req.user.refId || "");
  return String(req.query.studentId || "");
};

const getHealth = async (req, res) => {
  try {
    if (req.user.role === "student") {
      const ownId = resolveStudentIdForRequest(req);
      if (!ownId) {
        return res.status(400).json({ success: false, message: "studentId is required" });
      }
      const record = await StudentHealthRecord.findOne({
        schoolId: req.tenantId,
        studentId: ownId,
      }).lean();
      return res.json({ success: true, data: record || null });
    }

    const { studentId } = req.query;
    if (!studentId) {
      return res.status(400).json({ success: false, message: "studentId is required" });
    }

    // Teachers must be scoped to the student's class.
    if (req.user.role === "teacher" && req.teacherScope) {
      const Student = require("../models/Student");
      const student = await Student.findOne({
        schoolId: req.tenantId,
        $or: [
          { admissionNo: studentId },
          { _id: studentId },
        ],
      }).lean();
      if (!student || !req.teacherScope.has(student.class, student.section)) {
        return res.status(403).json({ success: false, message: "Access denied — student is not in your assigned classes" });
      }
    }

    const record = await StudentHealthRecord.findOne({
      schoolId: req.tenantId,
      studentId,
    }).lean();

    res.json({ success: true, data: record || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const upsertHealth = async (req, res) => {
  try {
    const body = req.body || {};
    let studentId;
    if (req.user.role === "student") {
      studentId = resolveStudentIdForRequest(req);
      if (!studentId) {
        return res.status(400).json({ success: false, message: "studentId is required" });
      }
    } else {
      studentId = body.studentId;
      if (!studentId) {
        return res.status(400).json({ success: false, message: "studentId is required" });
      }

      // Teachers must be scoped to the student's class.
      if (req.user.role === "teacher" && req.teacherScope) {
        const Student = require("../models/Student");
        const student = await Student.findOne({
          schoolId: req.tenantId,
          $or: [
            { admissionNo: studentId },
            { _id: studentId },
          ],
        }).lean();
        if (!student || !req.teacherScope.has(student.class, student.section)) {
          return res.status(403).json({ success: false, message: "Access denied — student is not in your assigned classes" });
        }
      }
    }

    const update = pickHealthFields(body);
    update.lastUpdatedBy = req.user.refId || req.user.id;
    update.lastUpdatedByRole = req.user.role;

    const record = await StudentHealthRecord.findOneAndUpdate(
      { schoolId: req.tenantId, studentId },
      { $set: update },
      { upsert: true, new: true, runValidators: true },
    );

    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getHealth, upsertHealth };

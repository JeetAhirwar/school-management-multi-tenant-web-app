const StudentAcademicRecord = require("../models/StudentAcademicRecord");
const { tryStudentModel } = require("../services/academicYearService");
const ObjectId = require("mongoose").Types.ObjectId;
const { findMissingMasterRefs, missingMessage } = require("../utils/masterRefs");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

function isObjectId(value) {
  return ObjectId.isValid(value) && String(new ObjectId(value)) === String(value);
}

// POST /api/academics/transfers
// body: { studentId (admissionNo | _id), type: "class_section"|"school",
//         toClass?, toSection?, remarks?, session? }
//
// Distinguishes the two transfer concepts explicitly:
//   - class_section: an in-year move to another class/section within the school.
//   - school: the student is leaving; status flips to "Transferred".
// Academic promotion is a SEPARATE workflow (/api/academics/promotions).
const create = async (req, res) => {
  try {
    const { studentId, type, toClass, toSection, remarks, session } = req.body;
    if (!["class_section", "school"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be class_section or school" });
    }

    const Student = await tryStudentModel();
    if (!Student) {
      return res.status(503).json({ success: false, message: "Student database is not configured for academic-service" });
    }
    if (studentId == null || String(studentId).trim() === "") {
      return res.status(400).json({ success: false, message: "studentId is required" });
    }

    const lookup = isObjectId(studentId) ? { _id: studentId, schoolId: req.tenantId } : { admissionNo: studentId, schoolId: req.tenantId };
    const student = await Student.findOne(lookup);
    if (!student) return res.status(404).json({ success: false, message: "Student not found in this school" });

    if (type === "class_section") {
      if (!toClass || String(toClass).trim() === "") {
        return res.status(400).json({ success: false, message: "toClass is required for a class/section transfer" });
      }
      const missing = await findMissingMasterRefs({ schoolId: req.tenantId, class: toClass, section: toSection });
      if (missing.length) {
        return res.status(400).json({ success: false, message: missingMessage(missing), missing });
      }
    }

    const toSectionValue = type === "class_section" ? (toSection || student.section || "") : null;
    const record = await StudentAcademicRecord.create({
      schoolId: req.tenantId,
      studentId: student.admissionNo,
      studentName: student.name,
      session: session || null,
      kind: "transfer",
      status: "Transferred",
      fromClass: student.class,
      fromSection: student.section,
      toClass: type === "class_section" ? toClass : null,
      toSection: toSectionValue,
      remarks,
      actedBy: req.user && req.user._id,
      actedByName: (req.user && req.user.name) || null,
    });

    if (type === "class_section") {
      student.class = toClass;
      student.section = toSectionValue;
    } else {
      student.status = "Transferred";
    }
    await student.save();

    res.json({ success: true, data: { ...record.toObject(), type } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const history = async (req, res) => {
  try {
    const { studentId, session } = req.query;
    const filter = { schoolId: req.tenantId, kind: "transfer" };
    if (studentId) filter.studentId = studentId;
    if (session) filter.session = session;
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      StudentAcademicRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      StudentAcademicRecord.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { create, history };
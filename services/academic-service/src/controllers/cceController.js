const CoScholastic = require("../models/CoScholastic");
const { resolveStudentAdmissionNo } = require("../services/academicYearService");

// Co-scholastic (CCE) records — CLIENT-REQ-027. Read is student-scoped via
// scopeStudentQuery (students always read their own row); write requires
// exams:write and upserts one row per student+session+term.
const GRADES = ["", "A1", "A2", "B1", "B2", "C", "D"];
const MAX_AREAS = 20;

const getCoScholastic = async (req, res) => {
  try {
    const { studentId: raw, term, session } = req.query;
    if (!raw) return res.status(400).json({ success: false, message: "studentId is required" });
    if (!term) return res.status(400).json({ success: false, message: "term is required" });
    const studentId = await resolveStudentAdmissionNo(req.tenantId, raw);
    const doc = await CoScholastic.findOne({
      schoolId: req.tenantId,
      studentId,
      term: String(term).trim(),
      session: session ? String(session).trim() : "",
    }).lean();
    res.json({ success: true, data: doc || null });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const upsertCoScholastic = async (req, res) => {
  try {
    const { studentId: raw, term, session, class: cls, section, areas, comments } = req.body || {};
    if (!raw) return res.status(400).json({ success: false, message: "studentId is required" });
    if (!term || !["Term 1", "Term 2", "Final"].includes(term)) {
      return res.status(400).json({ success: false, message: "term must be Term 1, Term 2 or Final" });
    }
    if (areas != null && !Array.isArray(areas)) {
      return res.status(400).json({ success: false, message: "areas must be an array" });
    }
    const cleanAreas = (areas || []).map((row) => ({
      area: String(row && row.area || "").trim(),
      grade: GRADES.includes(row && row.grade) ? row.grade : "",
      remark: String((row && row.remark) || "").trim().slice(0, 200),
    }));
    if (cleanAreas.length > MAX_AREAS) {
      return res.status(400).json({ success: false, message: `At most ${MAX_AREAS} areas are allowed` });
    }
    for (const row of cleanAreas) {
      if (!row.area) return res.status(400).json({ success: false, message: "Every area needs a name" });
      if (row.area.length > 60) {
        return res.status(400).json({ success: false, message: `Area name too long: ${row.area.slice(0, 20)}...` });
      }
    }
    const studentId = await resolveStudentAdmissionNo(req.tenantId, raw);
    const key = {
      schoolId: req.tenantId,
      studentId,
      term: String(term).trim(),
      session: session ? String(session).trim() : "",
    };
    const updatedBy = (req.user && (req.user.id || req.user.refId)) || "";
    const doc = await CoScholastic.findOneAndUpdate(
      key,
      {
        $set: {
          ...key,
          class: cls ? String(cls) : "",
          section: section ? String(section) : "",
          areas: cleanAreas,
          comments: String(comments || "").trim().slice(0, 500),
          updatedBy,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(err.status || (err.name === "ValidationError" ? 400 : 500)).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = { getCoScholastic, upsertCoScholastic };

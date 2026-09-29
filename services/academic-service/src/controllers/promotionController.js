const mongoose = require("mongoose");
const StudentAcademicRecord = require("../models/StudentAcademicRecord");
const {
  computeStudentSummary,
  rosterFor,
  tryStudentModel,
  ACADEMIC_RECORD_STATUSES,
} = require("../services/academicYearService");
const { suggestPromotionStatus } = require("../utils/grading");
const { findMissingMasterRefs, missingMessage } = require("../utils/masterRefs");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Class/section targets must resolve to active masters when the school has
// configured its catalogs (lenient for legacy free-string schools).
async function assertMoveRefs(schoolId, decisions) {
  for (const move of decisions || []) {
    if (move.toClass == null || String(move.toClass).trim() === "") continue;
    const missing = await findMissingMasterRefs({
      schoolId,
      class: move.toClass,
      section: move.toSection,
    });
    if (missing.length) {
      const wrong = new Error(missingMessage(missing));
      wrong.status = 400;
      throw wrong;
    }
  }
}

// GET /api/academics/promotions/preview?fromSession=&toSession=&class=&section=
// Pure read: computes the suggested decision per student for the from-session
// and never mutates anything.
const preview = async (req, res) => {
  try {
    const { class: cls, section, fromSession, toSession } = req.query;
    if (!fromSession) return res.status(400).json({ success: false, message: "fromSession is required" });
    if (!toSession) return res.status(400).json({ success: false, message: "toSession is required" });

    const roster = await rosterFor({ schoolId: req.tenantId, class: cls, section, fromSession });
    const rows = await Promise.all(
      roster.map(async (student) => {
        const summary = await computeStudentSummary({
          schoolId: req.tenantId,
          studentId: student.admissionNo,
          session: fromSession,
          class: cls || student.class,
          section,
        });
        return {
          studentId: student.admissionNo,
          name: student.name,
          rollNo: student.rollNo || null,
          class: student.class,
          section: student.section,
          suggestedStatus: suggestPromotionStatus(summary),
          summary,
        };
      }),
    );

    const counts = Object.fromEntries(
      ACADEMIC_RECORD_STATUSES.map((status) => [status, rows.filter((r) => r.suggestedStatus === status).length]),
    );

    res.json({
      success: true,
      count: rows.length,
      data: { fromSession, toSession, class: cls || null, section: section || null, counts, rows },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// POST /api/academics/promotions  { fromSession, toSession, decisions: [...] }
// Validates every decision BEFORE writing anything, so a bad payload cannot
// leave a partially committed batch. Duplicate promotion per (student, session)
// is rejected (unique index + application check).
const commit = async (req, res) => {
  try {
    const { fromSession, toSession, decisions } = req.body;
    if (!fromSession || !toSession) {
      return res.status(400).json({ success: false, message: "fromSession and toSession are required" });
    }
    if (!Array.isArray(decisions) || decisions.length === 0) {
      return res.status(400).json({ success: false, message: "decisions is required" });
    }

    // --- Pass 1: validate every decision (no writes yet) ---
    // Reject missing / blank / in-batch duplicate studentIds up front.
    // Without this, a duplicate would only be caught by the unique
    // (schoolId, studentId, session, kind) index AFTER earlier records were
    // already committed, leaving a partially applied promotion batch.
    const seenStudents = new Set();
    for (const move of decisions) {
      const studentId = move.studentId == null ? "" : String(move.studentId).trim();
      if (studentId === "") {
        return res.status(400).json({ success: false, message: "Every promotion decision must include a studentId" });
      }
      if (seenStudents.has(studentId)) {
        return res.status(400).json({ success: false, message: `Duplicate student ${studentId} in the promotion batch` });
      }
      seenStudents.add(studentId);
    }
    for (const move of decisions) {
      if (!ACADEMIC_RECORD_STATUSES.includes(move.status)) {
        return res.status(400).json({ success: false, message: `Unknown promotion status: ${move.status}` });
      }
      const moving = move.status === "Promoted" || move.status === "Promoted with Conditions";
      if (moving && (move.toClass == null || String(move.toClass).trim() === "")) {
        return res.status(400).json({
          success: false,
          message: `toClass is required for student ${move.studentId} (${move.status})`,
        });
      }
      if (!moving && (move.toClass != null || move.toSection != null)) {
        return res.status(400).json({
          success: false,
          message: `Student ${move.studentId} (${move.status}) must not carry a target class/section`,
        });
      }
    }
    await assertMoveRefs(req.tenantId, decisions);

    const Student = await tryStudentModel();
    if (!Student) {
      return res.status(503).json({ success: false, message: "Student database is not configured for academic-service" });
    }

    // --- Pass 2: resolve students, check duplicates, compute summaries ---
    const records = [];
    const rowById = {};
    for (const move of decisions) {
      const student = await Student.findOne({ schoolId: req.tenantId, admissionNo: move.studentId });
      if (!student) {
        return res.status(404).json({ success: false, message: `Student ${move.studentId} not found in this school` });
      }
      const duplicate = await StudentAcademicRecord.findOne({
        schoolId: req.tenantId,
        studentId: move.studentId,
        session: fromSession,
        kind: "promotion",
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: `Student ${move.studentId} already has a promotion record for ${fromSession}`,
        });
      }
      const moving = move.status === "Promoted" || move.status === "Promoted with Conditions";
      const toSection = moving ? (move.toSection || student.section || "") : null;
      const summary = await computeStudentSummary({
        schoolId: req.tenantId,
        studentId: student.admissionNo,
        session: fromSession,
        class: student.class,
        section: student.section,
      });
      records.push({
        schoolId: req.tenantId,
        studentId: student.admissionNo,
        studentName: student.name,
        session: fromSession,
        kind: "promotion",
        status: move.status,
        fromClass: student.class,
        fromSection: student.section,
        toClass: moving ? move.toClass : null,
        toSection,
        summary: {
          totalObtained: summary.totalObtained,
          totalMax: summary.totalMax,
          percentage: summary.percentage,
          failedSubjects: summary.failedSubjects,
          subjects: summary.subjects.map((s) => ({
            subject: s.subject,
            marksObtained: s.marksObtained,
            maxMarks: s.maxMarks,
            passed: s.passed,
          })),
        },
        remarks: move.remarks,
        actedBy: req.user && req.user._id,
        actedByName: (req.user && req.user.name) || null,
      });
      rowById[student.admissionNo] = { student, move };
    }

    // --- Pass 3: apply (all validation passed above) ---
    // Written as two bulk operations: all promotion records first, then all
    // student updates. Records carry pre-assigned _ids so that a failure in
    // either op can compensate (delete this batch's records) and a mid-pass
    // failure can never leave a partially committed promotion batch.
    for (const record of records) {
      record._id = new mongoose.Types.ObjectId();
    }
    const plannedRecordIds = records.map((r) => r._id);

    const studentOps = [];
    for (const record of records) {
      const { student, move } = rowById[record.studentId];
      const set = {};
      if (move.status === "Promoted" || move.status === "Promoted with Conditions") {
        set.class = move.toClass;
        set.section = record.toSection;
      }
      if (move.status === "Transferred") set.status = "Transferred";
      if (move.status === "Graduated") set.status = "Alumni";
      if (Object.keys(set).length > 0) {
        studentOps.push({
          updateOne: {
            filter: { schoolId: req.tenantId, admissionNo: record.studentId },
            update: { $set: set },
          },
        });
      }
    }

    let inserted;
    try {
      inserted = await StudentAcademicRecord.insertMany(records, { ordered: true });
      if (studentOps.length > 0) await Student.bulkWrite(studentOps);
    } catch (err) {
      // Compensating rollback: remove any records this batch already wrote so
      // a failure mid-pass never surfaces as a partial promotion.
      await StudentAcademicRecord.deleteMany({ _id: { $in: plannedRecordIds } }).catch(() => {});
      if (err && err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: `One of the students already has a promotion record for ${fromSession}`,
        });
      }
      throw err;
    }

    res.json({ success: true, count: inserted.length, data: inserted });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// GET /api/academics/promotions/history?studentId=&session=&status=
// Audit trail of promotion records (immutable snapshots).
const history = async (req, res) => {
  try {
    const { studentId, session, status } = req.query;
    const filter = { schoolId: req.tenantId, kind: "promotion" };
    if (studentId) filter.studentId = studentId;
    if (session) filter.session = session;
    if (status) filter.status = status;
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

module.exports = { preview, commit, history };
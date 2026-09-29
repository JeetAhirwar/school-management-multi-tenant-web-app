const {
  deriveNextSession,
  rosterFor,
  computeStudentSummary,
  enrolledClasses,
  ACADEMIC_RECORD_STATUSES,
} = require("../services/academicYearService");
const { suggestPromotionStatus } = require("../utils/grading");

// POST /api/academics/rollover/prepare  { fromSession?, toSession? }
//
// Controlled rollover preparation. PURELY read-only and rollback-safe: it
// derives the next session label, then for every enrolled class reports the
// roster with suggested promotion decisions for the outgoing session. Nothing
// is mutated here; the actual promotion commit and the next-session activation
// are separate, explicitly-confirmed steps (promotions API + sessions API).
const prepare = async (req, res) => {
  try {
    const fromSession = String(req.body.fromSession || "").trim() || null;
    const toSession = String(req.body.toSession || "").trim() || (fromSession ? deriveNextSession(fromSession) : null);
    if (!fromSession || !toSession) {
      return res.status(400).json({ success: false, message: "fromSession and toSession are required to prepare a rollover" });
    }

    const classes = await enrolledClasses({ schoolId: req.tenantId });
    const perClass = [];
    for (const cls of classes) {
      const roster = await rosterFor({ schoolId: req.tenantId, class: cls, fromSession });
      const rows = await Promise.all(
        roster.map(async (student) => {
          const summary = await computeStudentSummary({
            schoolId: req.tenantId,
            studentId: student.admissionNo,
            session: fromSession,
            class: student.class,
            section: student.section,
          });
          return { studentId: student.admissionNo, name: student.name, suggestedStatus: suggestPromotionStatus(summary), summary };
        }),
      );
      const counts = Object.fromEntries(
        ACADEMIC_RECORD_STATUSES.map((status) => [status, rows.filter((r) => r.suggestedStatus === status).length]),
      );
      perClass.push({ class: cls, students: rows.length, counts });
    }

    res.json({
      success: true,
      data: {
        fromSession,
        toSession,
        classes: perClass,
        totalStudents: perClass.reduce((sum, c) => sum + c.students, 0),
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { prepare };
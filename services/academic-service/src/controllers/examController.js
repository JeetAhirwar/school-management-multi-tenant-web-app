const Exam = require("../models/Exam");
const Marks = require("../models/Marks");
const ExamType = require("../models/ExamType");
const SchoolClass = require("../models/SchoolClass");
const SchoolSection = require("../models/SchoolSection");
const SchoolSubject = require("../models/SchoolSubject");
const TimeSlot = require("../models/TimeSlot");
const Room = require("../models/Room");
const School = require("../models/School");
const ObjectId = require("mongoose").Types.ObjectId;
const Attendance = require("../models/Attendance");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const {
  findMissingMasterRefs,
  missingMessage,
} = require("../utils/masterRefs");
const { computeGradeWith, computeResultWith, resolveScale } = require("../utils/grading");
const { resolveStudentAdmissionNo, tryStudentModel } = require("../services/academicYearService");
const { fetchSessionWindow } = require("../utils/sessionWindow");
const { generateReportCardPdf } = require("../utils/reportCardPdf");
const { notifyClassStudents } = require("../utils/notify");

// Mass-assignment guard: only these fields may be set from the request body.
const EXAM_FIELDS = [
  "examName", "class", "section", "subject", "date", "startTime", "endTime", "room", "maxMarks", "passingMarks", "session",
  "kind", "term", "cceTool",
];
// Optional reference to the master entity that produced the snapshot string.
const EXAM_REF_FIELDS = [
  "examTypeId", "classId", "sectionId", "subjectId", "timeSlotId", "roomId",
];
const TYPE_OF = {
  examTypeId: ExamType,
  classId: SchoolClass,
  sectionId: SchoolSection,
  subjectId: SchoolSubject,
  timeSlotId: TimeSlot,
  roomId: Room,
};
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

function isObjectId(value) {
  return ObjectId.isValid(value) && String(new ObjectId(value)) === String(value);
}

// Result publishing state machine: draft -> reviewed -> published.
const EXAM_STATUS_TRANSITIONS = {
  draft: ["reviewed"],
  reviewed: ["draft", "published"],
  published: ["reviewed"],
};

// Subjects toggle status:"active"/"inactive"; the other masters use active:true.
const ACTIVE_FILTERS = {
  subjectId: { status: "active" },
};

// Verify every master reference resolves inside THIS tenant. Rejects a value a
// school has no right to (cross-tenant leakage) and keeps exam records tenant-consistent.
async function validateMasterRefs(schoolId, body) {
  if (!body) return;
  const toCheck = [];
  for (const field of EXAM_REF_FIELDS) {
    const value = body[field];
    if (value == null || value === "") continue;
    if (!isObjectId(value)) {
      const wrong = new Error(`${field} must be a valid ObjectId`);
      wrong.status = 400;
      throw wrong;
    }
    toCheck.push([field, value]);
  }
  for (const [field, value] of toCheck) {
    const Model = TYPE_OF[field];
    const active = ACTIVE_FILTERS[field] || { active: true };
    const exists = await Model.findOne({ _id: value, schoolId, ...active }).lean();
    if (!exists) {
      const wrong = new Error(`Referenced ${field} does not exist for this school or is inactive`);
      wrong.status = 400;
      throw wrong;
    }
  }
}

// Snapshot strings (class/section/subject/room) must resolve to active masters
// when this school has configured the catalogs. Lenient while a kind's catalog
// is empty (legacy free-string exams keep working). On update, unchanged
// values are skipped: a legacy stored value is never re-validated, only new or
// changed values enter the dataset through the check.
async function assertSnapshotRefs(schoolId, body, existing) {
  const same = (kind) => {
    const value = body && body[kind];
    if (value == null || String(value).trim() === "") return false;
    if (existing) {
      const prev = existing[kind];
      if (prev != null && String(prev).trim() === String(value).trim()) return true;
    }
    return false;
  };
  const owned = {};
  for (const kind of ["class", "section", "subject", "room"]) {
    if (!same(kind)) owned[kind] = body ? body[kind] : undefined;
  }
  const missing = await findMissingMasterRefs({ schoolId, ...owned });
  if (missing.length) {
    const wrong = new Error(missingMessage(missing));
    wrong.status = 400;
    throw wrong;
  }
}

function toTimeSlotPayload(body) {
  const { timeSlotId, startTime, endTime } = body || {};
  const payload = {};
  if (timeSlotId) payload.timeSlotId = timeSlotId;
  if (startTime || endTime) {
    if (startTime) payload.startTime = startTime;
    if (endTime) payload.endTime = endTime;
  }
  return Object.keys(payload).length ? payload : null;
}

// Persist the validated master refs (examTypeId, classId, sectionId, subjectId,
// timeSlotId, roomId) that the snapshot strings came from.
function toRefPayload(body) {
  const payload = {};
  for (const field of EXAM_REF_FIELDS) {
    const value = body && body[field];
    if (value != null && value !== "") payload[field] = value;
  }
  return payload;
}

const createExam = async (req, res) => {
  try {
    await validateMasterRefs(req.tenantId, req.body);
    await assertSnapshotRefs(req.tenantId, req.body);
    const slot = toTimeSlotPayload(req.body) || {};
    const refs = toRefPayload(req.body);
    const payload = pick(req.body, EXAM_FIELDS);
    const exam = await Exam.create({
      ...payload,
      ...slot,
      ...refs,
      schoolId: req.tenantId,
    });
    res.status(201).json({ success: true, data: exam });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

const getExams = async (req, res) => {
  try {
    const { class: cls, section, subject, status, session, kind, term, cceTool } = req.query;
    const filter = { schoolId: req.tenantId };
    if (cls) filter.class = cls;
    if (section) filter.section = section;
    if (subject) filter.subject = subject;
    if (status) filter.status = status;
    if (session) filter.session = session;
    if (kind) filter.kind = kind;
    if (term) filter.term = term;
    if (cceTool) filter.cceTool = cceTool;
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      Exam.find(filter).sort({ date: 1 }).skip(skip).limit(limit),
      Exam.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateExam = async (req, res) => {
  try {
    const existing = await Exam.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!existing) return res.status(404).json({ success: false, message: "Exam not found" });

    if (existing.status === "published") {
      return res.status(400).json({
        success: false,
        message: "This exam's results are published. Unpublish it (status -> reviewed) before editing.",
      });
    }

    await validateMasterRefs(req.tenantId, req.body);
    await assertSnapshotRefs(req.tenantId, req.body, existing);

    // Merge snapshot times with the existing record so a ref-only update never
    // blanks times, and an explicit startTime/endTime overrides them.
    const slot = toTimeSlotPayload(req.body) || {};
    const refs = toRefPayload(req.body);
    const fields = {
      ...pick(req.body, EXAM_FIELDS),
      ...(slot.startTime || slot.endTime || slot.timeSlotId ? slot : {}),
      ...refs,
    };

    const exam = await Exam.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      fields,
      { new: true, runValidators: true },
    );
    res.json({ success: true, data: exam });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

const deleteExam = async (req, res) => {
  try {
    const exam = await Exam.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found" });
    if (exam.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft exams can be deleted. Unpublish or revert the exam to draft first.",
      });
    }
    await Marks.deleteMany({ schoolId: req.tenantId, examId: exam._id });
    await Exam.deleteOne({ _id: exam._id });
    res.json({ success: true, message: "Exam deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /exams/:id/status — explicit result publishing state machine.
const updateExamStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["draft", "reviewed", "published"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be draft, reviewed or published" });
    }
    const exam = await Exam.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found" });
    if (exam.status === status) return res.json({ success: true, data: exam });

    const allowed = EXAM_STATUS_TRANSITIONS[exam.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move an exam from '${exam.status}' to '${status}' (allowed: ${allowed.join(", ") || "none"})`,
      });
    }
    if (status === "published") {
      const count = await Marks.countDocuments({ schoolId: req.tenantId, examId: exam._id });
      if (count === 0) {
        return res.status(400).json({ success: false, message: "Cannot publish an exam with no marks entered." });
      }
    }
    exam.status = status;
    await exam.save();
    if (status === "published") {
      notifyClassStudents({
        schoolId: req.tenantId,
        class: exam.class,
        section: exam.section,
        title: "Results Published",
        message: `Results for ${exam.examName} (${exam.subject}) are now available.`,
        kind: "exam",
        link: "/student/results",
      });
    }
    res.json({ success: true, data: exam });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

const enterMarks = async (req, res) => {
  try {
    const { examId, entries } = req.body; // entries: [{ studentId, marksObtained }]
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: "entries is required" });
    }
    const exam = await Exam.findOne({ _id: examId, schoolId: req.tenantId });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found" });
    if (exam.status === "published") {
      return res.status(400).json({
        success: false,
        message: "This exam's results are published. Unpublish it (status -> reviewed) before revising marks.",
      });
    }

    const results = [];
    // Grades/pass are computed against the school's ACTIVE grading scale at
    // entry time (scale switch takes effect for new entries immediately).
    const scale = await resolveScale(req.tenantId);
    const passPct = exam.passingMarks != null ? exam.passingMarks : scale.passPct != null ? scale.passPct : 33;
    for (const e of entries) {
      const studentId = String(e.studentId || "").trim();
      if (!studentId) {
        return res.status(400).json({ success: false, message: "Every entry needs a studentId" });
      }
      const obtained = Number(e.marksObtained);
      if (Number.isNaN(obtained) || obtained < 0 || obtained > exam.maxMarks) {
        return res.status(400).json({
          success: false,
          message: `marksObtained for ${studentId} must be a number between 0 and ${exam.maxMarks}`,
        });
      }
      const result = computeResultWith(scale, obtained, exam.maxMarks, passPct);
      // findOneAndUpdate skips the pre("save") grade hook, so grade/pct/passed
      // are computed here from the scale-aware grading util.
      const doc = await Marks.findOneAndUpdate(
        { schoolId: req.tenantId, studentId, examId, subject: exam.subject },
        {
          schoolId: req.tenantId,
          studentId,
          examId,
          examName: exam.examName,
          class: exam.class,
          section: exam.section || "",
          session: exam.session || "",
          subject: exam.subject,
          marksObtained: obtained,
          maxMarks: exam.maxMarks,
          passingMarks: passPct,
          pct: +result.pct.toFixed(2),
          grade: result.grade,
          passed: result.passed,
          remarks: e.remarks,
        },
        { new: true, upsert: true, runValidators: true },
      );
      results.push(doc);
    }
    res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

const getMarks = async (req, res) => {
  try {
    const { examId, class: cls, section, session } = req.query;
    const filter = { schoolId: req.tenantId };
    if (req.user && (req.user.role === "student" || req.user.role === "parent")) {
      // Students are locked to their own records and parents to their linked
      // children, and BOTH only ever see published results (scopeStudentQuery
      // mirrors the self-scoping at the route).
      filter.studentId = req.query.studentId;
      const published = await Exam.find({ schoolId: req.tenantId, status: "published" })
        .select("_id")
        .lean();
      filter.examId = { $in: published.map((e) => e._id) };
      if (session) filter.session = session;
      const { page, limit, skip } = paginate(req.query);
      const [data, total] = await Promise.all([
        Marks.find(filter).sort({ studentId: 1 }).skip(skip).limit(limit),
        Marks.countDocuments(filter),
      ]);
      return res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
    }
    // Teachers are constrained to their assignment scope; admins may filter.
    if (req.teacherScope) filter.class = req.teacherScope.class;
    else if (cls) filter.class = cls;
    if (examId) filter.examId = examId;
    if (section) filter.section = section;
    if (session) filter.session = session;
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      Marks.find(filter).sort({ studentId: 1 }).skip(skip).limit(limit),
      Marks.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// examId -> { status, session } map for a report card's mark rows.
async function examStatusMap(schoolId, marks) {
  const ids = [...new Set(marks.map((m) => String(m.examId)).filter(Boolean))];
  if (!ids.length) return new Map();
  const exams = await Exam.find({ _id: { $in: ids }, schoolId })
    .select("_id status session")
    .lean();
  return new Map(exams.map((exam) => [String(exam._id), exam]));
}

// Students are locked to published results. Admins/teachers see drafts too
// unless they explicitly opt out with includeDrafts=0.
function includeDrafts(req) {
  if (req.user && ["student", "parent"].includes(req.user.role)) return false;
  return String(req.query.includeDrafts ?? "1") !== "0";
}

// Shared report-card builder: the JSON endpoint and the PDF endpoint both
// render this payload so the on-screen card and the printable PDF never drift.
async function buildReportCard(schoolId, opts) {
  const { studentId: rawStudentId, examName, session, includeDrafts: drafts, teacherScope } = opts;
  const sessionParam = session ? String(session).trim() : "";
  const studentId = await resolveStudentAdmissionNo(schoolId, rawStudentId);

  const filter = { schoolId, studentId };
  if (teacherScope) filter.class = teacherScope.class;
  if (examName) filter.examName = examName;
  if (sessionParam) filter.session = sessionParam;
  const marks = await Marks.find(filter).sort({ subject: 1 });

  const seeAll = drafts;
  const statusById = await examStatusMap(schoolId, marks);
  const visible = marks.filter((m) => {
    if (seeAll) return true;
    const exam = statusById.get(String(m.examId));
    return !!exam && exam.status === "published";
  });

  const scale = await resolveScale(schoolId);
  const subjects = visible.map((m) => {
    const exam = statusById.get(String(m.examId));
    const result = computeResultWith(scale, m.marksObtained, m.maxMarks, m.passingMarks ?? null);
    return {
      _id: m._id,
      subject: m.subject,
      marksObtained: m.marksObtained,
      maxMarks: m.maxMarks,
      pct: m.pct != null ? m.pct : +result.pct.toFixed(2),
      grade: m.grade || result.grade,
      passed: m.passed != null ? m.passed : result.passed,
      passingMarks: m.passingMarks ?? (scale.passPct != null ? scale.passPct : 33),
      session: (exam && exam.session) || m.session || null,
      status: exam ? exam.status : m.status || null,
      examId: m.examId,
      examName: m.examName,
      remarks: m.remarks || null,
    };
  });

  const totalObtained = subjects.reduce((sum, row) => sum + row.marksObtained, 0);
  const totalMax = subjects.reduce((sum, row) => sum + row.maxMarks, 0);
  const percentage = totalMax ? ((totalObtained / totalMax) * 100).toFixed(2) : "0.00";

  // Session echo: the explicit filter wins; otherwise report the single
  // session all returned rows belong to (null when mixed/legacy).
  const rowSessions = [...new Set(subjects.map((s) => s.session).filter(Boolean))];
  const sessEcho = sessionParam || (rowSessions.length === 1 ? rowSessions[0] : null);

  // Class rank: position among students who have marks for the SAME exams
  // (and class/section) as this student, ranked on total percentage. Students
  // with no marks in those exams cannot be ranked and are excluded.
  let classRank = null;
  let totalStudents = 0;
  if (visible.length) {
    const anchor = visible.find((m) => m.class) || null;
    const cohortFilter = {
      schoolId,
      examId: { $in: visible.map((m) => m.examId) },
    };
    if (anchor) {
      cohortFilter.class = anchor.class;
      if (anchor.section) cohortFilter.section = anchor.section;
    }
    const cohort = await Marks.find(cohortFilter)
      .select("studentId marksObtained maxMarks")
      .lean();
    const byStudent = {};
    for (const row of cohort) {
      if (!byStudent[row.studentId]) byStudent[row.studentId] = { obtained: 0, max: 0 };
      byStudent[row.studentId].obtained += row.marksObtained;
      byStudent[row.studentId].max += row.maxMarks;
    }
    const standings = Object.entries(byStudent)
      .filter(([, v]) => v.max > 0)
      .map(([sid, v]) => ({ sid, pct: (v.obtained / v.max) * 100 }))
      .sort((a, b) => b.pct - a.pct);
    totalStudents = standings.length;
    const position = standings.findIndex((s) => s.sid === studentId);
    if (position >= 0) classRank = position + 1;
  }

  // Real attendance over the session's calendar window (resolved from the
  // session label via the auth-service internal endpoint). Without a window
  // the student's full attendance history is summarised instead.
  let attendance = null;
  {
    const window = sessEcho ? await fetchSessionWindow(schoolId, sessEcho) : null;
    const dateFilter = { schoolId, studentId };
    if (window && window.startDate && window.endDate) {
      const end = new Date(window.endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.date = { $gte: new Date(window.startDate), $lte: end };
    }
    const rows = await Attendance.find(dateFilter).select("date status").lean();
    if (rows.length) {
      let present = 0;
      let absent = 0;
      let leave = 0;
      let halfDays = 0;
      for (const row of rows) {
        if (row.status === "Present") present += 1;
        else if (row.status === "Absent") absent += 1;
        else if (row.status === "Leave") leave += 1;
        else if (row.status === "Half Day") halfDays += 1;
      }
      const workingDays = rows.length;
      const attended = present + halfDays * 0.5;
      attendance = {
        present,
        absent,
        leave,
        halfDays,
        workingDays,
        pct: +((attended / workingDays) * 100).toFixed(1),
        window: window ? { startDate: window.startDate, endDate: window.endDate } : null,
      };
    }
  }

  return {
    studentId,
    examName: examName || "All",
    session: sessEcho,
    class: visible[0]?.class || null,
    section: visible[0]?.section || null,
    classRank,
    totalStudents,
    attendance,
    gradeBands: Array.isArray(scale.bands) ? scale.bands : null,
    passPct: scale.passPct != null ? scale.passPct : 33,
    subjects,
    totalObtained,
    totalMax,
    percentage,
    publishedOnly: !seeAll,
  };
}

const getReportCard = async (req, res) => {
  try {
    if (!req.query.studentId) {
      return res.status(400).json({ success: false, message: "studentId is required" });
    }
    const data = await buildReportCard(req.tenantId, {
      studentId: req.query.studentId,
      examName: req.query.examName,
      session: req.query.session,
      includeDrafts: includeDrafts(req),
      teacherScope: req.teacherScope,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// Server-rendered report card PDF (CLIENT-REQ-026). Same query contract as
// the JSON endpoint; streams a printable A4 attachment.
const getReportCardPdf = async (req, res) => {
  try {
    if (!req.query.studentId) {
      return res.status(400).json({ success: false, message: "studentId is required" });
    }
    const data = await buildReportCard(req.tenantId, {
      studentId: req.query.studentId,
      examName: req.query.examName,
      session: req.query.session,
      includeDrafts: includeDrafts(req),
      teacherScope: req.teacherScope,
    });
    const school = (await School.findOne({ _id: req.tenantId }).lean()) || {};
    let student = null;
    const Student = await tryStudentModel();
    if (Student) {
      student = await Student.findOne({ schoolId: req.tenantId, admissionNo: data.studentId }).lean();
    }
    const buffer = await generateReportCardPdf(data, school, student);
    const rawName = (student && student.name) || data.studentId || "student";
    const filename = `report-card-${String(rawName).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// Aggregated academic performance for a whole class (per exam). Class Teachers
// are scoped to their assignment by scopeClassTeacher. School admins pick any class.
const getClassSummary = async (req, res) => {
  try {
    // Class-level aggregates expose every other student's marks. Students have
    // their own report card endpoint and must never reach class summary data.
    if (req.user && req.user.role === "student") {
      return res.status(403).json({ success: false, message: "Students can only view their own report card" });
    }

    const { class: cls, section, examName, session } = req.query;
    if (!cls) return res.status(400).json({ success: false, message: "class is required" });
    const scale = await resolveScale(req.tenantId);

    const filter = { schoolId: req.tenantId, class: cls };
    if (examName) filter.examName = examName;
    if (session) filter.session = session;
    const marks = await Marks.find(filter).lean();

    // Same publish visibility rule as the report card: students off, staff on.
    const seeAll = includeDrafts(req);
    const statusById = await examStatusMap(req.tenantId, marks);
    const visible = marks.filter((m) => {
      if (seeAll) return true;
      const exam = statusById.get(String(m.examId));
      return !!exam && exam.status === "published";
    });

    const byStudent = {};
    for (const m of visible) {
      if (!byStudent[m.studentId]) {
        byStudent[m.studentId] = { studentId: m.studentId, subjects: [], total: 0, maxTotal: 0 };
      }
      byStudent[m.studentId].subjects.push({
        subject: m.subject,
        marksObtained: m.marksObtained,
        maxMarks: m.maxMarks,
        grade: m.grade || computeGradeWith(scale, m.marksObtained, m.maxMarks),
      });
      byStudent[m.studentId].total += m.marksObtained;
      byStudent[m.studentId].maxTotal += m.maxMarks;
    }

    let totalObtained = 0;
    let totalMax = 0;
    const rows = Object.values(byStudent).map((g) => {
      const pct = g.maxTotal ? (g.total / g.maxTotal) * 100 : 0;
      totalObtained += g.total;
      totalMax += g.maxTotal;
      g.subjects.sort((a, b) => a.subject.localeCompare(b.subject));
      return { ...g, pct: +pct.toFixed(2), grade: computeGradeWith(scale, g.total, g.maxTotal) };
    });

    const classAverage = totalMax ? (totalObtained / totalMax) * 100 : 0;
    const subjectAverages = {};
    for (const m of visible) {
      if (!subjectAverages[m.subject]) subjectAverages[m.subject] = { obtained: 0, max: 0, count: 0 };
      subjectAverages[m.subject].obtained += m.marksObtained;
      subjectAverages[m.subject].max += m.maxMarks;
      subjectAverages[m.subject].count += 1;
    }
    const subjectAvgList = Object.entries(subjectAverages).map(([subject, v]) => ({
      subject,
      averagePct: v.max ? +(((v.obtained / v.max) * 100).toFixed(2)) : 0,
    }));

    rows.sort((a, b) => b.pct - a.pct);

    res.json({
      success: true,
      count: rows.length,
      data: {
        examName: examName || null,
        session: session || null,
        class: cls,
        section: section || null,
        classAveragePct: +classAverage.toFixed(2),
        subjectAverages: subjectAvgList,
        students: rows,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// Term rollup (CLIENT-REQ-021): cross-exam standings for ONE term — every
// exam carrying the term label for a class, ranked on aggregate percentage.
// Students are barred (this exposes every classmate's standing).
const getTermRollup = async (req, res) => {
  try {
    if (req.user && req.user.role === "student") {
      return res.status(403).json({ success: false, message: "Students can only view their own report card" });
    }
    const { class: cls, section, term, session } = req.query;
    if (!cls) return res.status(400).json({ success: false, message: "class is required" });
    if (!term) return res.status(400).json({ success: false, message: "term is required" });

    const filter = { schoolId: req.tenantId, class: cls, term };
    if (section) filter.section = section;
    if (session) filter.session = session;
    let exams = await Exam.find(filter)
      .select("_id examName subject status session date")
      .sort({ date: 1 })
      .lean();

    const seeAll = includeDrafts(req);
    if (!seeAll) exams = exams.filter((e) => e.status === "published");
    if (!exams.length) {
      return res.json({
        success: true,
        data: {
          term,
          class: cls,
          section: section || null,
          session: session || null,
          exams: [],
          classAveragePct: null,
          totalStudents: 0,
          students: [],
        },
      });
    }

    const marks = await Marks.find({
      schoolId: req.tenantId,
      examId: { $in: exams.map((e) => e._id) },
    }).lean();
    const scale = await resolveScale(req.tenantId);

    const byStudent = {};
    for (const m of marks) {
      if (!byStudent[m.studentId]) {
        byStudent[m.studentId] = { studentId: m.studentId, obtained: 0, max: 0, subjects: 0, failed: 0 };
      }
      const row = byStudent[m.studentId];
      row.obtained += m.marksObtained;
      row.max += m.maxMarks;
      row.subjects += 1;
      const result = computeResultWith(scale, m.marksObtained, m.maxMarks, m.passingMarks ?? null);
      if (!result.passed) row.failed += 1;
    }
    const students = Object.values(byStudent)
      .filter((s) => s.max > 0)
      .map((s) => {
        const pct = (s.obtained / s.max) * 100;
        return {
          studentId: s.studentId,
          obtained: s.obtained,
          max: s.max,
          pct: +pct.toFixed(2),
          grade: computeGradeWith(scale, s.obtained, s.max),
          subjects: s.subjects,
          failedSubjects: s.failed,
        };
      })
      .sort((a, b) => b.pct - a.pct);
    students.forEach((row, i) => {
      row.rank = i + 1;
    });

    const totals = marks.reduce(
      (acc, m) => ({ obtained: acc.obtained + m.marksObtained, max: acc.max + m.maxMarks }),
      { obtained: 0, max: 0 },
    );

    res.json({
      success: true,
      data: {
        term,
        class: cls,
        section: section || null,
        session: session || null,
        exams: exams.map((e) => ({
          _id: e._id,
          examName: e.examName,
          subject: e.subject,
          session: e.session,
          status: e.status,
        })),
        classAveragePct: totals.max ? +((totals.obtained / totals.max) * 100).toFixed(2) : null,
        totalStudents: students.length,
        students,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createExam,
  getExams,
  updateExam,
  deleteExam,
  updateExamStatus,
  enterMarks,
  getMarks,
  getReportCard,
  getReportCardPdf,
  getClassSummary,
  getTermRollup,
};
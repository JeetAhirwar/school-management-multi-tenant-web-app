const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readFe = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel/src", rel), "utf8");

const { GRADING_PRESETS, validateScaleBands } = require("../src/utils/gradingPresets");
const {
  computeGrade,
  computeResult,
  computeGradeWith,
  computeResultWith,
  resolveScale,
  DEFAULT_SCALE,
} = require("../src/utils/grading");
const Exam = require("../src/models/Exam");
const Marks = require("../src/models/Marks");
const GradingScale = require("../src/models/GradingScale");
const CoScholastic = require("../src/models/CoScholastic");

// ---------------------------------------------------------------------------
// CLIENT-REQ-022/023/024/025: presets, validation, scale-aware grading
// ---------------------------------------------------------------------------

test("phase6: every built-in preset passes structural band validation", () => {
  for (const preset of GRADING_PRESETS) {
    assert.equal(
      validateScaleBands(preset.bands),
      null,
      `${preset.key} preset bands must validate`,
    );
  }
  assert.deepEqual(
    GRADING_PRESETS.map((p) => p.key),
    ["default", "cbse", "icse"],
  );
});

test("phase6: validateScaleBands rejects malformed band lists", () => {
  assert.match(validateScaleBands(undefined), /non-empty/);
  assert.match(validateScaleBands([]), /non-empty/);
  assert.match(
    validateScaleBands([
      { grade: "A", minPct: 40 },
      { grade: "B", minPct: 80 },
    ]),
    /descending/,
  );
  assert.match(
    validateScaleBands([
      { grade: "A", minPct: 80 },
      { grade: "A", minPct: 0 },
    ]),
    /duplicate grade/,
  );
  assert.match(
    validateScaleBands([
      { grade: "A", minPct: 101 },
      { grade: "F", minPct: 0 },
    ]),
    /between 0 and 100/,
  );
  assert.match(
    validateScaleBands([
      { grade: "A", minPct: 80 },
      { grade: "F", minPct: 10 },
    ]),
    /minPct 0/,
  );
  assert.match(validateScaleBands([{ grade: "", minPct: 0 }]), /grade is required/);
  assert.match(
    validateScaleBands([{ grade: "ABCDEFGHIJKLM", minPct: 0 }]),
    /at most 12/,
  );
});

test("phase6: scale-aware grading stays byte-identical to the legacy default rules", () => {
  const boundaries = [0, 1, 32, 33, 49, 50, 59, 60, 69, 70, 79, 80, 89, 90, 99, 100];
  for (const pct of boundaries) {
    const obtained = pct; // max = 100 → pct === obtained
    assert.equal(
      computeGradeWith(DEFAULT_SCALE, obtained, 100),
      computeGrade(obtained, 100),
      `grade mismatch at ${pct}%`,
    );
    const withScale = computeResultWith(DEFAULT_SCALE, obtained, 100, null);
    const legacy = computeResult(obtained, 100, 33);
    assert.equal(withScale.grade, legacy.grade);
    assert.equal(withScale.passed, legacy.passed, `pass mismatch at ${pct}%`);
  }
});

test("phase6: CBSE preset grades on the published A1..E percentage bands", () => {
  const cbse = GRADING_PRESETS.find((p) => p.key === "cbse");
  const g = (pct) => computeGradeWith(cbse, pct, 100);
  assert.equal(g(100), "A1");
  assert.equal(g(91), "A1");
  assert.equal(g(90), "A2");
  assert.equal(g(81), "A2");
  assert.equal(g(80), "B1");
  assert.equal(g(71), "B1");
  assert.equal(g(70), "B2");
  assert.equal(g(61), "B2");
  assert.equal(g(60), "C1");
  assert.equal(g(51), "C1");
  assert.equal(g(50), "C2");
  assert.equal(g(41), "C2");
  assert.equal(g(40), "D");
  assert.equal(g(33), "D");
  assert.equal(g(32), "E");
  assert.equal(g(0), "E");
});

test("phase6: ICSE preset grades and passes on its 35% threshold", () => {
  const icse = GRADING_PRESETS.find((p) => p.key === "icse");
  assert.equal(computeGradeWith(icse, 95, 100), "A+");
  assert.equal(computeGradeWith(icse, 44, 100), "D");
  assert.equal(computeGradeWith(icse, 40, 100), "D");
  assert.equal(computeGradeWith(icse, 39, 100), "E");
  assert.equal(computeGradeWith(icse, 35, 100), "E");
  assert.equal(computeGradeWith(icse, 34, 100), "F");
  assert.equal(computeResultWith(icse, 34, 100, null).passed, false);
  assert.equal(computeResultWith(icse, 35, 100, null).passed, true);
});

test("phase6: an exam's explicit pass % overrides the scale's passPct", () => {
  const icse = GRADING_PRESETS.find((p) => p.key === "icse"); // passPct 35
  // scale passPct applies when no override is present
  assert.equal(computeResultWith(icse, 34, 100, null).passed, false);
  // explicit override (exam.passingMarks snapshot) wins in both directions
  assert.equal(computeResultWith(icse, 34, 100, 33).passed, true);
  // an exam's explicit pass % (snapshot) wins over the scale's 40% in BOTH directions
  assert.equal(computeResultWith({ passPct: 40 }, 35, 100, 33).passed, true);
  assert.equal(computeResultWith({ passPct: 40 }, 35, 100, null).passed, false);
  assert.equal(computeResultWith({ passPct: 40 }, 40, 100, null).passed, true);
});

// ---------------------------------------------------------------------------
// CLIENT-REQ-022: scale snapshot wiring in models + shared rollup
// ---------------------------------------------------------------------------

test("phase6: Marks derives grades from the ACTIVE scale in an async pre-save hook", () => {
  const src = read("../src/models/Marks.js");
  assert.match(src, /marksSchema\.pre\("save", async function/);
  assert.match(src, /await resolveScale\(this\.schoolId\)/);
  assert.match(src, /computeResultWith\(scale, this\.marksObtained, this\.maxMarks/);
  // New rows snapshot the resolved pass %; legacy rows keep null.
  const pp = Marks.schema.path("passingMarks");
  assert.ok(Object.prototype.hasOwnProperty.call(pp.options, "default"));
  assert.equal(pp.options.default, null);
});

test("phase6: Exam passes null so the scale's passPct applies to new exams", () => {
  assert.equal(Exam.schema.path("passingMarks").defaultValue, null);
  const src = read("../src/models/Exam.js");
  assert.match(src, /passingMarks: \{ type: Number, default: null \}/);
});

test("phase6: grading util resolves the tenant's active scale with a default fallback", () => {
  const src = read("../src/utils/grading.js");
  assert.match(src, /async function resolveScale\(schoolId\)/);
  assert.match(src, /findOne\(\{ schoolId, isDefault: true, active: true \}\)/);
  assert.match(src, /computeGradeWith|gradeFromBands/);
  assert.equal(typeof resolveScale, "function");
  assert.equal(DEFAULT_SCALE.passPct, 33);
});

test("phase6: enterMarks and the shared student rollup both compute against the scale", () => {
  const examCtrl = read("../src/controllers/examController.js");
  assert.match(examCtrl, /const scale = await resolveScale\(req\.tenantId\)/);
  assert.match(examCtrl, /computeResultWith\(scale, obtained, exam\.maxMarks, passPct\)/);
  assert.match(examCtrl, /passingMarks: passPct/);

  const yearService = read("../src/services/academicYearService.js");
  assert.match(yearService, /const scale = await resolveScale\(schoolId\)/);
  assert.match(yearService, /computeResultWith\(scale, mark\.marksObtained/);
});

// ---------------------------------------------------------------------------
// CLIENT-REQ-022/025: scale API — tenant-scoped CRUD, activation, mounting
// ---------------------------------------------------------------------------

test("phase6: grading-scale routes gate reads with exams:read and writes with exams:write", () => {
  const routes = read("../src/routes/gradingScaleRoutes.js");
  assert.match(routes, /router\.get\("\/", requirePermission\("exams:read"\), ctrl\.listScales\)/);
  assert.match(routes, /router\.get\("\/active", requirePermission\("exams:read"\), ctrl\.getActiveScale\)/);
  assert.match(routes, /router\.post\("\/", requirePermission\("exams:write"\), ctrl\.createScale\)/);
  assert.match(routes, /router\.patch\("\/:id", requirePermission\("exams:write"\), ctrl\.updateScale\)/);
  assert.match(routes, /router\.post\("\/:id\/activate", requirePermission\("exams:write"\), ctrl\.activateScale\)/);
  assert.match(routes, /router\.delete\("\/:id", requirePermission\("exams:write"\), ctrl\.deleteScale\)/);
  assert.match(routes, /validateObjectIdParam/);
  assert.match(routes, /verifyToken, resolveTenant, requireTenant/);
});

test("phase6: scale controller seeds presets tolerating 11000 and never drops the default", () => {
  const ctrl = read("../src/controllers/gradingScaleController.js");
  assert.match(ctrl, /err\.code !== 11000/); // seeding tolerates duplicate-key races
  assert.match(ctrl, /isDefault: i === 0/); // default preset claims the unique slot
  assert.match(
    ctrl,
    /\{ schoolId: req\.tenantId, _id: \{ \$ne: scale\._id \}, isDefault: true \},\s*\{ \$set: \{ isDefault: false \} \}/,
  );
  assert.match(ctrl, /if \(scale\.isDefault\) \{\s*return res\.status\(400\)/); // delete guard
  assert.match(ctrl, /if \(!next && scale\.isDefault\)/); // deactivating the default blocked
});

test("phase6: GradingScale enforces a single active scale per school (partial unique index)", () => {
  const indexes = GradingScale.schema.indexes();
  const partial = indexes.find(
    ([keys, opts]) =>
      keys.schoolId === 1 &&
      keys.isDefault === 1 &&
      opts &&
      opts.unique &&
      opts.partialFilterExpression &&
      opts.partialFilterExpression.isDefault === true,
  );
  assert.ok(partial, "expected partial unique index {schoolId, isDefault}");
  const keyIndex = indexes.find(([keys, opts]) => keys.schoolId === 1 && keys.key === 1 && opts && opts.unique);
  assert.ok(keyIndex, "expected unique {schoolId, key} index");
});

test("phase6: the scale subsystem is mounted in the service and proxied by the gateway", () => {
  const apiIndex = read("../src/index.js");
  assert.match(apiIndex, /app\.use\("\/api\/grading-scales", gradingScaleRoutes\)/);
  assert.match(apiIndex, /app\.use\("\/api\/cce", cceRoutes\)/);
  const gateway = read("../../../api-gateway/src/index.js");
  assert.match(gateway, /path: "\/api\/grading-scales"/);
  assert.match(gateway, /path: "\/api\/cce"/);
});

// ---------------------------------------------------------------------------
// CLIENT-REQ-026: report card — session filter, rank, real attendance, PDF
// ---------------------------------------------------------------------------

test("phase6: report card filters by session, computes class rank and real attendance", () => {
  const src = read("../src/controllers/examController.js");
  assert.match(src, /if \(sessionParam\) filter\.session = sessionParam/);
  assert.match(src, /classRank = position \+ 1/);
  assert.match(src, /totalStudents = standings\.length/);
  assert.match(src, /const window = sessEcho \? await fetchSessionWindow\(schoolId, sessEcho\) : null/);
  assert.match(src, /Attendance\.find\(dateFilter\)/);
  assert.match(src, /pct: \+\(\(attended \/ workingDays\) \* 100\)\.toFixed\(1\)/);
  // The JSON and PDF endpoints share ONE builder so they cannot drift.
  assert.match(src, /async function buildReportCard\(schoolId, opts\)/);
  assert.match(src, /const getReportCardPdf = async \(req, res\)/);
});

test("phase6: report-card routes (JSON + PDF) both require marks:read with student scope", () => {
  const routes = read("../src/routes/marksRoutes.js");
  assert.match(
    routes,
    /router\.get\("\/report-card", requirePermission\("marks:read"\), scopeStudentQuery, scopeClassTeacher, ctrl\.getReportCard\)/,
  );
  assert.match(
    routes,
    /router\.get\("\/report-card\/pdf", requirePermission\("marks:read"\), scopeStudentQuery, scopeClassTeacher, ctrl\.getReportCardPdf\)/,
  );
});

test("phase6: session calendar lookup is internal-key guarded and fail-soft", () => {
  const authInternal = read("../../auth-service/src/routes/internalRoutes.js");
  assert.match(authInternal, /router\.use\(internalGuard\)/);
  assert.match(authInternal, /router\.get\("\/sessions\/window", getSessionWindow\)/);
  const authCtrl = read("../../auth-service/src/controllers/academicSessionController.js");
  assert.match(authCtrl, /getSessionWindow:/);
  assert.match(authCtrl, /AcademicSession\.findOne\(\{\s*schoolId,\s*name: String\(name\)\.trim\(\),/);

  const util = read("../src/utils/sessionWindow.js");
  assert.match(util, /X-Internal-Key/);
  assert.match(util, /INTERNAL_NOTIFY_KEY/);
  assert.match(util, /return null;/); // never throws — attendance degrades gracefully
});

test("phase6: report-card PDF renders real pdfkit bytes and the dep is declared", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.dependencies.pdfkit, "^0.20.2");

  const util = read("../src/utils/reportCardPdf.js");
  assert.match(util, /require\("pdfkit"\)/);
  assert.match(util, /generateReportCardPdf/);

  // Real byte check: the generator must emit a valid PDF without any DB.
  const { generateReportCardPdf } = require("../src/utils/reportCardPdf");
  const data = {
    studentId: "ADM001",
    examName: "Term 1",
    session: "2026-27",
    class: "10",
    section: "A",
    classRank: 1,
    totalStudents: 25,
    attendance: { present: 90, absent: 2, leave: 1, halfDays: 1, workingDays: 94, pct: 96.3 },
    gradeBands: DEFAULT_SCALE.bands,
    subjects: [
      { subject: "Mathematics", marksObtained: 92, maxMarks: 100, grade: "A+", passed: true },
      { subject: "Science", marksObtained: 78, maxMarks: 100, grade: "A", passed: true },
    ],
    totalObtained: 170,
    totalMax: 200,
    percentage: "85.00",
    publishedOnly: true,
  };
  return generateReportCardPdf(data, { name: "Test School" }, { name: "Aarav", admissionNo: "ADM001" }).then(
    (buf) => {
      assert.ok(Buffer.isBuffer(buf));
      assert.equal(buf.slice(0, 5).toString(), "%PDF-");
      assert.ok(buf.length > 1000, `PDF suspiciously small: ${buf.length}`);
    },
  );
});

// ---------------------------------------------------------------------------
// CLIENT-REQ-021: typed kinds, term rollup, status machine, notify link
// ---------------------------------------------------------------------------

test("phase6: Exam carries typed kind/term/cceTool fields whitelisted for writes", () => {
  assert.deepEqual(Exam.schema.path("kind").enumValues, [
    "unit_test", "fa", "sa", "term", "quiz", "practical", "other",
  ]);
  assert.deepEqual(Exam.schema.path("term").enumValues, ["", "Term 1", "Term 2", "Final"]);
  assert.deepEqual(Exam.schema.path("cceTool").enumValues, ["", "FA1", "FA2", "FA3", "FA4", "SA1", "SA2"]);
  const ctrl = read("../src/controllers/examController.js");
  assert.match(ctrl, /"kind", "term", "cceTool",/);
  assert.match(ctrl, /if \(kind\) filter\.kind = kind;/);
  assert.match(ctrl, /if \(term\) filter\.term = term;/);
  assert.match(ctrl, /if \(cceTool\) filter\.cceTool = cceTool;/);
});

test("phase6: term-rollup endpoint is registered ahead of /:id and barred from students", () => {
  const routes = read("../src/routes/examRoutes.js");
  const rollupIdx = routes.indexOf('router.get("/term-rollup"');
  const idIdx = routes.indexOf('router.put("/:id"');
  assert.ok(rollupIdx >= 0, "term-rollup route missing");
  assert.ok(idIdx >= 0, "/:id route missing");
  assert.ok(rollupIdx < idIdx, "/term-rollup must be declared before /:id");
  assert.match(routes, /requirePermission\("exams:read"\), scopeClassTeacher, ctrl\.getTermRollup/);

  const ctrl = read("../src/controllers/examController.js");
  assert.match(ctrl, /const getTermRollup = async \(req, res\)/);
  assert.match(ctrl, /message: "Students can only view their own report card" \}/);
  assert.match(ctrl, /row\.rank = i \+ 1/);
  assert.match(ctrl, /if \(!term\) return res\.status\(400\)/);
});

test("phase6: publishing notifies students at the real results route (not the dead /marks link)", () => {
  const ctrl = read("../src/controllers/examController.js");
  assert.match(ctrl, /link: "\/student\/results"/);
  assert.doesNotMatch(ctrl, /link: "\/marks"/);
  const app = readFe("App.jsx");
  assert.match(app, /path="\/student\/results"/);
});

test("phase6: result status machine stays draft->reviewed->published with publish guards", () => {
  const ctrl = read("../src/controllers/examController.js");
  assert.match(ctrl, /const EXAM_STATUS_TRANSITIONS = \{\s*draft: \["reviewed"\],\s*reviewed: \["draft", "published"\],\s*published: \["reviewed"\],\s*\}/);
  assert.match(ctrl, /const allowed = EXAM_STATUS_TRANSITIONS\[exam\.status\] \|\| \[\];/);
  assert.match(ctrl, /if \(!allowed\.includes\(status\)\)/);
  assert.match(ctrl, /Cannot publish an exam with no marks entered/);
  assert.match(ctrl, /status must be draft, reviewed or published/);
  // Only draft exams can be edited or deleted — publish is not a silent door.
  assert.match(ctrl, /This exam's results are published\. Unpublish it \(status -> reviewed\) before editing\./);
  assert.match(ctrl, /Only draft exams can be deleted/);
});

// ---------------------------------------------------------------------------
// CLIENT-REQ-027: CCE co-scholastic structures
// ---------------------------------------------------------------------------

test("phase6: CoScholastic is one row per student+session+term on the 6-point scale", () => {
  const indexes = CoScholastic.schema.indexes();
  const unique = indexes.find(
    ([keys, opts]) =>
      keys.schoolId === 1 &&
      keys.studentId === 1 &&
      keys.session === 1 &&
      keys.term === 1 &&
      opts &&
      opts.unique,
  );
  assert.ok(unique, "expected unique {schoolId, studentId, session, term}");
  assert.deepEqual(
    CoScholastic.schema.path("areas").schema.path("grade").enumValues,
    ["", "A1", "A2", "B1", "B2", "C", "D"],
  );
  assert.deepEqual(CoScholastic.schema.path("term").enumValues, ["Term 1", "Term 2", "Final"]);
});

test("phase6: CCE routes read with exams:read (student-scoped) and write with exams:write", () => {
  const routes = read("../src/routes/cceRoutes.js");
  assert.match(
    routes,
    /requirePermission\("exams:read"\),\s*scopeStudentQuery,\s*ctrl\.getCoScholastic/,
  );
  assert.match(routes, /requirePermission\("exams:write"\), ctrl\.upsertCoScholastic/);
  const ctrl = read("../src/controllers/cceController.js");
  assert.match(ctrl, /findOneAndUpdate\(/);
  assert.match(ctrl, /upsert: true/);
  assert.match(ctrl, /resolveStudentAdmissionNo\(req\.tenantId, raw\)/);
});

// ---------------------------------------------------------------------------
// Frontend wiring: scale loader, report card, CCE, rollup, PDF download
// ---------------------------------------------------------------------------

test("phase6: FE grading lib loads the ACTIVE scale and everything derives from it", () => {
  const grading = readFe("lib/grading.js");
  assert.match(grading, /export async function loadActiveGradingScale\(\)/);
  assert.match(grading, /export function setActiveScale\(scale\)/);
  assert.match(grading, /api\.gradingScales\.active\(\)/);
  assert.match(grading, /function currentBands\(\)/);
  assert.match(grading, /const bands = currentBands\(\)/);
  const app = readFe("App.jsx");
  assert.match(app, /loadActiveGradingScale\(\)/);
  assert.match(app, /if \(isAuth\) loadActiveGradingScale\(\);/);
  assert.match(app, /path="\/grading-scales"/);
  assert.match(app, /permission="exams:read"/);
});

test("phase6: GradingScales page offers CRUD + activation with band validation", () => {
  const page = readFe("pages/GradingScales.jsx");
  assert.match(page, /api\.gradingScales\s*\.\s*list\(\)/);
  assert.match(page, /api\.gradingScales\.activate\(/);
  assert.match(page, /api\.gradingScales\.remove\(/);
  assert.match(page, /loadActiveGradingScale\(\)/);
  assert.match(page, /descending order/); // client-side band validation mirrors the API
  assert.match(page, /usePermission\("exams:write"\)/);
  const sidebar = readFe("layout/Sidebar.jsx");
  assert.match(sidebar, /to: "\/grading-scales"/);
  assert.match(sidebar, /perm: "exams:read"/);
  const api = readFe("lib/api.js");
  assert.match(api, /gradingScales: \{/);
  assert.match(api, /activate: \(id\) => request\(`\/grading-scales\/\$\{id\}\/activate`/);
});

test("phase6: ReportCard filters by session, shows rank + real attendance, downloads the PDF", () => {
  const page = readFe("pages/ReportCard.jsx");
  assert.match(page, /api\.sessions\s*\n?\s*\.list\(\)/);
  assert.match(page, /sessionFilter \? `&session=\$\{encodeURIComponent\(sessionFilter\)\}`/);
  assert.match(page, /classRank/);
  assert.match(page, /report\?\.attendance/);
  assert.match(page, /attendance\.present.*attendance\.absent/);
  assert.match(page, /downloadReportCardPdf\(reportQuery\)/);
  const api = readFe("lib/api.js");
  assert.match(api, /downloadReportCardPdf: async \(params = ""\)/);
  assert.match(api, /marks\/report-card\/pdf/);
});

test("phase6: Examination page edits kind/term/cceTool, filters kinds and loads term rollups", () => {
  const page = readFe("pages/Examination.jsx");
  assert.match(page, /kind: "other"/);
  assert.match(page, /KIND_OPTIONS/);
  assert.match(page, /kindFilter/);
  assert.match(page, /form\.kind === "fa" \|\| form\.kind === "sa"/); // CCE tool select
  assert.match(page, /term: form\.term \|\| ""/);
  assert.match(page, /loadRollup/);
  assert.match(page, /api\.exams\.termRollup\(/);
  assert.match(page, /Term Rollup/);
  const api = readFe("lib/api.js");
  assert.match(api, /termRollup: \(params = ""\)/);
});

test("phase6: ReportCard hosts the CCE editor (staff) and prints the co-scholastic table", () => {
  const page = readFe("pages/ReportCard.jsx");
  assert.match(page, /DEFAULT_CCE_AREAS/);
  assert.match(page, /function CceEditor\(/);
  assert.match(page, /api\.cce\.saveCoScholastic\(/);
  assert.match(page, /api\.cce\s*\n?\s*\.getCoScholastic\(/);
  assert.match(page, /Co-Scholastic Assessment/);
  assert.match(page, /usePermission\("exams:write"\)/);
  const api = readFe("lib/api.js");
  assert.match(api, /cce: \{/);
  assert.match(api, /saveCoScholastic: \(body\) => request\("\/cce\/co-scholastic", json\("PUT", body\)\)/);
});

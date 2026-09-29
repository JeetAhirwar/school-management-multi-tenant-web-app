const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readFe = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel/src", rel), "utf8");

const ctrl = read("../src/controllers/homeworkController.js");
const subCtrl = read("../src/controllers/homeworkSubmissionController.js");
const routes = read("../src/routes/homeworkRoutes.js");
const subRoutes = read("../src/routes/homeworkSubmissionRoutes.js");

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

test("phase7: Homework model persists status and indexes the class-scope query", () => {
  const Homework = require("../src/models/Homework");
  const st = Homework.schema.path("status");
  assert.ok(st, "status path missing");
  assert.deepEqual(
    st.enumValues,
    ["Pending", "In Progress", "Completed", "Overdue"],
  );
  assert.equal(st.defaultValue, "Pending");
  assert.ok(Homework.schema.path("title").isRequired, "title must stay required");
  assert.ok(Homework.schema.path("dueDate").isRequired, "dueDate must stay required");

  const indexes = Homework.schema.indexes();
  assert.ok(
    indexes.some(
      ([keys]) =>
        keys.schoolId === 1 && keys.class === 1 && keys.section === 1,
    ),
    "expected compound {schoolId,class,section} index",
  );
});

test("phase7: HomeworkSubmission keeps the unique one-per-student constraint", () => {
  const Sub = require("../src/models/HomeworkSubmission");
  const uniq = Sub.schema.indexes().find(([keys, opts]) => opts && opts.unique);
  assert.ok(uniq, "unique index missing");
  const [keys] = uniq;
  assert.deepEqual(
    { schoolId: keys.schoolId, homeworkId: keys.homeworkId, studentId: keys.studentId },
    { schoolId: 1, homeworkId: 1, studentId: 1 },
  );
});

// ---------------------------------------------------------------------------
// Assignment distribution scoping (CLIENT-REQ-030 class scope)
// ---------------------------------------------------------------------------

test("phase7: status is in the mass-assignment whitelist; server fields are not", () => {
  assert.match(ctrl, /"priority", "status", "dueDate"/);
  for (const banned of ["schoolId", "assignedBy", "createdAt"]) {
    assert.ok(
      !new RegExp(`"${banned}"`).test(
        ctrl.slice(ctrl.indexOf("HOMEWORK_FIELDS"), ctrl.indexOf("const pick")),
      ),
      `${banned} must stay server-owned`,
    );
  }
});

test("phase7: parent homework reads are scoped to their children's classes", () => {
  assert.match(ctrl, /req\.user\.role === "parent"/);
  assert.match(ctrl, /childClassPairs\(req\.tenantId, req\.user\.linkedStudentIds\)/);
  assert.match(ctrl, /filter\.\$or = pairs/);
  // fail-secure: no resolvable children -> match nothing, never {schoolId} alone
  assert.match(ctrl, /filter\._id = \{ \$in: \[\] \}/);
  assert.match(ctrl, /async function childClassPairs/);
  assert.match(ctrl, /const Student = await tryStudentModel\(\)/);
  assert.match(ctrl, /admissionNo: \{ \$in: ids \}/);
  // no unscoped Homework.find for a parent path: child pairs gate the query
  assert.match(ctrl, /if \(pairs\.length\) filter\.\$or = pairs;/);
});

test("phase7: class-less student homework is rejected at creation", () => {
  assert.match(
    ctrl,
    /if \(!String\(req\.body\.class \|\| ""\)\.trim\(\)\) \{[\s\S]{0,200}Class is required for student homework/,
  );
});

test("phase7: homework routes guard teacher write bodies on create AND update", () => {
  assert.match(
    routes,
    /router\.post\("\/", requirePermission\("homework:write"\), scopeClassTeacher, guardClassBody\(\), ctrl\.createHomework\)/,
  );
  assert.match(
    routes,
    /router\.put\("\/:id", requirePermission\("homework:write"\), scopeClassTeacher, guardClassBody\(\), ctrl\.updateHomework\)/,
  );
});

// ---------------------------------------------------------------------------
// Submissions: review integrity + class list scoping
// ---------------------------------------------------------------------------

test("phase7: re-submitting a reviewed submission is blocked (no grade/status corruption)", () => {
  assert.match(subCtrl, /const prior = await HomeworkSubmission\.findOne\(/);
  assert.match(subCtrl, /if \(prior && prior\.status === "Reviewed"\)/);
  assert.match(subCtrl, /res\.status\(409\)\.json\(\{[\s\S]{0,300}already been reviewed/);
  // the block must sit BEFORE the upsert so Reviewed rows are never $set back
  const blockIdx = subCtrl.indexOf('prior.status === "Reviewed"');
  const upsertIdx = subCtrl.indexOf("{ new: true, upsert: true");
  assert.ok(blockIdx >= 0 && upsertIdx > blockIdx, "409 must precede the upsert");
});

test("phase7: class submission listing rejects parents and requires a scope", () => {
  assert.match(subCtrl, /\["student", "parent"\]\.includes\(req\.user\.role\)/);
  assert.match(subCtrl, /Only school staff can list class submissions/);
  // no class + no teacherScope -> explicit 400 (never a school-wide find)
  assert.match(
    subCtrl,
    /if \(!req\.teacherScope && !req\.query\.class\)[\s\S]{0,200}class is required for this request|else \{[\s\S]{0,200}return res\.status\(400\)\.json\(\{ success: false, message: "class is required for this request" \}\)/,
  );
  assert.match(subCtrl, /if \(req\.teacherScope\) \{[\s\S]{0,160}homeworkFilter\.class = req\.teacherScope\.class/);
});

test("phase7: ?homeworkId= is honored and scope-verified instead of overwritten", () => {
  const homeworkIdIdx = subCtrl.indexOf('if (req.query.homeworkId) {');
  const classListIdx = subCtrl.indexOf("const listSubmissionsForClass");
  assert.ok(homeworkIdIdx > classListIdx, "homeworkId branch must live in listSubmissionsForClass");
  assert.match(subCtrl, /const target = await Homework\.findOne\(\{ _id: req\.query\.homeworkId/);
  assert.match(subCtrl, /if \(req\.teacherScope && !req\.teacherScope\.has\(target\.class, target\.section\)\)/);
  assert.match(subCtrl, /filter\.homeworkId = target\._id;/);
  // ensure the old "set then overwrite with $in" shape is gone inside the branch
  const branch = subCtrl.slice(homeworkIdIdx, subCtrl.indexOf("} else {", homeworkIdIdx));
  assert.ok(!branch.includes("$in"), "homeworkId branch must not build a class-wide $in");
});

test("phase7: class/list route stays behind teacher scope + homework:read", () => {
  assert.match(
    subRoutes,
    /router\.get\("\/class\/list", requirePermission\("homework:read"\), scopeClassTeacher, ctrl\.listSubmissionsForClass\)/,
  );
});

test("phase7: review endpoint still requires homework:write + teacher scope", () => {
  assert.match(
    subRoutes,
    /router\.patch\("\/review\/:id", requirePermission\("homework:write"\), scopeClassTeacher, ctrl\.reviewSubmission\)/,
  );
  assert.match(subCtrl, /req\.teacherScope\.has\(homework\.class, homework\.section\)/);
  assert.match(subCtrl, /Number\(marks\) > \(homework\.maxMarks \|\| 100\)/);
});

test("phase7: student submit still derives identity from the token only", () => {
  assert.match(subCtrl, /Only students can submit homework/);
  assert.match(subCtrl, /const admissionNo = req\.user\.refId;/);
  assert.match(subCtrl, /String\(homework\.class\) !== String\(req\.user\.class\)/);
});

// ---------------------------------------------------------------------------
// Status UX persistence
// ---------------------------------------------------------------------------

test("phase7: status-only updates skip the assignee notification", () => {
  assert.match(ctrl, /const contentChanged = Object\.keys\(updates\)\.some\(\(k\) => k !== "status"\)/);
  assert.match(ctrl, /if \(hw && contentChanged && hw\.assignType === "staff"/);
});

test("phase7: FE status changes persist through the API with rollback", () => {
  const page = readFe("pages/Homework.jsx");
  assert.match(page, /const changeStatus = async \(id, newStatus\)/);
  assert.match(page, /await api\.homework\.update\(id, \{ status: newStatus \}\)/);
  assert.match(page, /status: oldStatus \?\? h\.status/);
  // derived Overdue only when nothing staff-chosen is stored
  assert.match(page, /status: isOverdue && base === "Pending" \? "Overdue" : base/);
  assert.match(page, /const base = item\.status \|\| "Pending"/);
  // form payload still ships status
  assert.match(page, /status: form\.status/);
});

test("phase7: FE admin page keeps the assignedToRole mapping intact", () => {
  const page = readFe("pages/Homework.jsx");
  assert.match(page, /assignedToRole: item\.assignedToRole \|\| ""/);
});

// ---------------------------------------------------------------------------
// Smoke: modules load cleanly
// ---------------------------------------------------------------------------

test("phase7: homework modules require() without side-effect failures", () => {
  const h = require("../src/controllers/homeworkController");
  const s = require("../src/controllers/homeworkSubmissionController");
  for (const name of ["createHomework", "getHomework", "updateHomework", "deleteHomework"]) {
    assert.equal(typeof h[name], "function", `${name} export missing`);
  }
  for (const name of ["submitHomework", "getMySubmissions", "reviewSubmission", "listSubmissionsForClass"]) {
    assert.equal(typeof s[name], "function", `${name} export missing`);
  }
  assert.ok(require("../src/routes/homeworkRoutes"));
  assert.ok(require("../src/routes/homeworkSubmissionRoutes"));
});

test("phase7: student FE hides submit once a submission exists (no silent resubmit path)", () => {
  const page = readFe("pages/student/Homework.jsx");
  assert.match(page, /\{!sub && !h\.overdue && \(/);
  assert.match(page, /sub\.status === "Reviewed" \? \(/);
});

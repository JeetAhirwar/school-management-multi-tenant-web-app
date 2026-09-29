const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readFe = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel/src", rel), "utf8");

// ---------------------------------------------------------------------------
// P4-A: student portal 3 pages — 403 -> 200 own data (CLIENT-REQ-053 / C-17)
// ---------------------------------------------------------------------------

test("student permission bundle exposes hostel/conduct/achievements reads (shared + FE mirror)", () => {
  const shared = read("../../../shared/src/utils/permissions.js");
  assert.match(
    shared,
    /student: \[[\s\S]*?"hostel:read"[\s\S]*?"conduct:read"[\s\S]*?"achievements:read"[\s\S]*?"leaves:apply"[\s\S]*?\]/,
  );
  const fe = readFe("lib/permissions.js");
  assert.match(
    fe,
    /student: \[[\s\S]*?"hostel:read"[\s\S]*?"conduct:read"[\s\S]*?"achievements:read"[\s\S]*?"leaves:apply"[\s\S]*?\]/,
  );
});

test("behavior routes use the role-aware read gate and force student list scope", () => {
  const src = read("../src/routes/behaviorRoutes.js");
  assert.match(src, /const perm = req\.user\?\.role === "student" \? "conduct:read" : "students:read";/);
  assert.match(
    src,
    /router\.get\("\/", gateBehaviorRead, scopeStudentQuery, scopeClassTeacher, ctrl\.listRecords\);/,
  );
  assert.match(src, /router\.get\("\/:id", gateBehaviorRead, ctrl\.getRecord\);/);
  // Writes stay admin/teacher only.
  assert.match(src, /requirePermission\("students:write"\)/);
});

test("achievement routes use the role-aware read gate and force student list scope", () => {
  const src = read("../src/routes/achievementRoutes.js");
  assert.match(src, /const perm = req\.user\?\.role === "student" \? "achievements:read" : "students:read";/);
  assert.match(
    src,
    /router\.get\("\/", gateAchievementRead, scopeStudentQuery, scopeClassTeacher, ctrl\.listAchievements\);/,
  );
  assert.match(src, /router\.get\("\/:id", gateAchievementRead, ctrl\.getAchievement\);/);
});

test(":id reads are ownership-guarded for students (no cross-student IDOR)", () => {
  const behavior = read("../src/controllers/behaviorController.js");
  const achievement = read("../src/controllers/achievementController.js");
  const guard = /\.\.\.\(req\.user\.role === "student" \? \{ studentId: req\.user\.refId \} : \{\}\)/;
  assert.match(behavior, guard);
  assert.match(achievement, guard);
});

test("hostel page: gate + controller already scope rooms to the student", () => {
  const routes = read("../../facility-service/src/routes/hostelRoutes.js");
  assert.match(routes, /router\.get\("\/", requirePermission\("hostel:read"\), ctrl\.getRooms\);/);
  const ctrl = read("../../facility-service/src/controllers/hostelController.js");
  assert.match(ctrl, /if \(req\.user\.role === "student"\) \{[\s\S]*?filter\.occupants = req\.user\.refId/);
});

test("document routes keep the role-aware gate precedent the portal pages follow", () => {
  const src = read("../../student-service/src/routes/documentRoutes.js");
  assert.match(src, /req\.user\?\.role === "student" \? "profile:read" : "students:read"/);
});

// ---------------------------------------------------------------------------
// P4-B: TeacherDashboard SSE trust + attendance history scope
//   (CLIENT-REQ-004 / CLIENT-REQ-054)
// ---------------------------------------------------------------------------

test("TeacherDashboard subscribes to the attendance SSE stream and cleans up", () => {
  const src = readFe("pages/TeacherDashboard.jsx");
  assert.match(src, /api\.attendanceStream\.subscribe\(\{/);
  assert.match(src, /api\.attendance\s*\n?\s*\.list\(q\)/);
  assert.match(src, /return unsubscribe;/);
  assert.match(src, /\}, \[cls, q\]\);/);
});

test("attendance report route is student-scoped like the list route", () => {
  const src = read("../src/routes/attendanceRoutes.js");
  assert.match(
    src,
    /router\.get\("\/report", requirePermission\("attendance:read"\), scopeStudentQuery, scopeClassTeacher, ctrl\.getAttendanceReport\);/,
  );
  assert.match(
    src,
    /router\.get\("\/", requirePermission\("attendance:read"\), scopeStudentQuery, scopeClassTeacher, ctrl\.getAttendance\);/,
  );
});

test("attendance SSE hub is tenant-scoped and the internal push is key-guarded", () => {
  const stream = read("../../communication-service/src/controllers/attendanceStream.js");
  assert.match(stream, /if \(!req\.tenantId && !isSuperAdmin\)/);
  assert.match(stream, /subscribeBroadcast\(schoolId, "attendance\.updated"/);
  const internal = read("../../communication-service/src/routes/internalAttendanceRoutes.js");
  assert.match(internal, /INTERNAL_NOTIFY_KEY/);
  assert.match(internal, /keyUsable/);
  const pusher = read("../src/controllers/attendanceController.js");
  assert.match(pusher, /attendance-stream\/internal\/push-attendance/);
});

// ---------------------------------------------------------------------------
// P4-C: academic masters + sessions hardening (Phase 6 dependency)
// ---------------------------------------------------------------------------

test("AcademicSession enforces a single current session at the DB level", () => {
  const src = read("../../auth-service/src/models/AcademicSession.js");
  assert.match(
    src,
    /\{ schoolId: 1, isCurrent: 1 \},\s*\{\s*unique: true, partialFilterExpression: \{ isCurrent: true \}\s*\}/,
  );
  assert.match(src, /\{ schoolId: 1, name: 1 \},\s*\{\s*unique: true\s*\}/);
});

test("session activation ends the previous current session; deletes stay guarded", () => {
  const src = read("../../auth-service/src/controllers/academicSessionController.js");
  assert.match(
    src,
    /await AcademicSession\.updateMany\(\s*\{\s*schoolId: req\.tenantId, _id: \{ \$ne: session\._id \}, isCurrent: true \},\s*\{ \$set: \{ isCurrent: false, status: "ended" \} \},\s*\);/,
  );
  assert.match(src, /if \(session\.isCurrent \|\| session\.status !== "planned"\)/);
  assert.match(src, /assertNoOverlap\(req\.tenantId, startDate, endDate/);
});

test("master factory stays tenant-scoped with duplicate -> 409 and race-tolerant seeding", () => {
  const src = read("../../../shared/src/master-data/index.js");
  assert.match(src, /schoolId: req\.tenantId,\s*tenantId: req\.tenantId,/);
  assert.match(src, /if \(existing\) \{\s*return res\.status\(409\)\.json\(\{/);
  assert.match(src, /if \(!err \|\| err\.code !== 11000\) throw err;/);
  // schoolId is never accepted from the request payload.
  assert.doesNotMatch(src, /\.\.\.req\.body,\s*\.\.\.scoped\(req\)/);
});

test("masters routes stay behind exams:read/exams:write with tenant middleware", () => {
  const src = read("../src/routes/examMasterRoutes.js");
  assert.match(src, /router\.use\(verifyToken, resolveTenant, requireTenant\);/);
  assert.match(src, /router\.get\("\/:kind", requirePermission\("exams:read"\), ctrl\.list\);/);
  assert.match(src, /router\.post\("\/:kind", requirePermission\("exams:write"\), ctrl\.create\);/);
});

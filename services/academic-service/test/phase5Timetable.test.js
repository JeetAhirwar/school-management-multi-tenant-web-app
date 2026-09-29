const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readFe = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel/src", rel), "utf8");

const {
  intervalsOverlap,
  findIntraDayOverlaps,
  findCrossDocConflicts,
} = require("../src/utils/periodConflictLib");

// ---------------------------------------------------------------------------
// CLIENT-REQ-020: interval-overlap unit tests (not just equal start times)
// ---------------------------------------------------------------------------

test("intervalsOverlap: adjacency is not an overlap", () => {
  assert.equal(intervalsOverlap("09:00", "10:00", "10:00", "11:00"), false);
  assert.equal(intervalsOverlap("10:00", "11:00", "09:00", "10:00"), false);
});

test("intervalsOverlap: partial overlap IS detected (the equality-only regression)", () => {
  assert.equal(intervalsOverlap("09:00", "10:00", "09:30", "10:30"), true);
  assert.equal(intervalsOverlap("09:30", "10:30", "09:00", "10:00"), true);
  // Same start, different end — the old check only caught exact equality.
  assert.equal(intervalsOverlap("09:00", "10:00", "09:00", "11:00"), true);
  assert.equal(intervalsOverlap("09:00", "11:00", "09:00", "10:00"), true);
});

test("intervalsOverlap: containment and malformed times", () => {
  assert.equal(intervalsOverlap("08:00", "10:00", "09:00", "09:30"), true);
  assert.equal(intervalsOverlap("09:00", "09:30", "08:00", "10:00"), true);
  assert.equal(intervalsOverlap("bad", "10:00", "09:00", "11:00"), false);
  assert.equal(intervalsOverlap("09:00", "10:00", undefined, "11:00"), false);
});

test("findIntraDayOverlaps: flags overlapping pairs inside one day", () => {
  const conflicts = findIntraDayOverlaps([
    { subject: "Math", startTime: "09:00", endTime: "10:00" },
    { subject: "Sci", startTime: "09:30", endTime: "10:30" },
    { subject: "Eng", startTime: "10:30", endTime: "11:30" },
  ]);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /Math.*09:00-10:00.*Sci.*09:30-10:30/);

  assert.equal(
    findIntraDayOverlaps([
      { subject: "Math", startTime: "09:00", endTime: "10:00" },
      { subject: "Eng", startTime: "10:00", endTime: "11:00" },
    ]).length,
    0,
  );
});

// ---------------------------------------------------------------------------
// CLIENT-REQ-019: room double-book reject (both sides must carry the room)
// ---------------------------------------------------------------------------

test("findCrossDocConflicts: teacher clash across class-sections", () => {
  const conflicts = findCrossDocConflicts(
    [{ teacherId: "t1", roomId: "", subject: "Math", startTime: "09:00", endTime: "10:00" }],
    [
      {
        label: "6-A",
        periods: [{ teacherId: "t1", teacherName: "Ms A", subject: "Eng", startTime: "09:30", endTime: "10:30" }],
      },
    ],
    "Monday",
  );
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /Ms A is already teaching Eng/);
  assert.match(conflicts[0], /Monday \(6-A\)/);
});

test("findCrossDocConflicts: room double-booking is rejected", () => {
  const conflicts = findCrossDocConflicts(
    [{ teacherId: "t9", roomId: "r1", roomName: "Lab 1", subject: "Math", startTime: "09:00", endTime: "10:00" }],
    [
      {
        label: "6-B",
        periods: [
          { teacherId: "t8", subject: "Sci", roomId: "r1", roomName: "Lab 1", startTime: "09:30", endTime: "10:30" },
        ],
      },
    ],
    "Monday",
  );
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /Room "Lab 1" is already occupied by Sci/);
});

test("findCrossDocConflicts: no false positives for free teachers/rooms or disjoint times", () => {
  const others = [
    {
      label: "6-A",
      periods: [{ teacherId: "t1", roomId: "r1", subject: "Eng", startTime: "10:00", endTime: "11:00" }],
    },
  ];
  // Different teacher + different room + disjoint time.
  assert.equal(
    findCrossDocConflicts(
      [{ teacherId: "t2", roomId: "r2", subject: "Math", startTime: "09:00", endTime: "10:00" }],
      others,
      "Monday",
    ).length,
    0,
  );
  // Same times but nobody in common.
  assert.equal(
    findCrossDocConflicts(
      [{ teacherId: "t2", roomId: "r2", subject: "Math", startTime: "10:00", endTime: "11:00" }],
      others,
      "Monday",
    ).length,
    0,
  );
  // Adjacent period with the same teacher is fine.
  assert.equal(
    findCrossDocConflicts(
      [{ teacherId: "t1", roomId: "", subject: "Math", startTime: "09:00", endTime: "10:00" }],
      others,
      "Monday",
    ).length,
    0,
  );
});

// ---------------------------------------------------------------------------
// P5-A wiring: model + controller
// ---------------------------------------------------------------------------

test("Timetable period schema carries roomId/roomName", () => {
  const src = read("../src/models/Timetable.js");
  assert.match(src, /roomId: \{ type: String, default: "" \}/);
  assert.match(src, /roomName: \{ type: String, default: "" \}/);
});

test("timetable controller uses interval-overlap checks and 409 conflict payloads", () => {
  const src = read("../src/controllers/timetableController.js");
  assert.match(src, /const intraDay = findIntraDayOverlaps\(check\.periods\);/);
  assert.match(src, /const crossConflicts = await findCrossClassConflicts\(\{/);
  assert.match(src, /message: "Scheduling conflict detected",\s*conflicts: intraDay/);
  assert.match(src, /message: "Scheduling conflict detected",\s*conflicts: crossConflicts/);
  assert.match(src, /const roomId = String\(p\.roomId \|\| ""\)\.trim\(\);/);
  // The old equality-only cross-class check is gone.
  assert.doesNotMatch(src, /p\.startTime === other\.startTime/);
  assert.doesNotMatch(src, /duplicate period startTime/);
});

test("masterRefs validates room names with the tenant Room catalog", () => {
  const refs = read("../src/utils/masterRefs.js");
  assert.match(refs, /async function findMissingRooms\(\{ schoolId, rooms \}\)/);
  assert.match(refs, /findMissingRooms/);
  const ctrl = read("../src/controllers/timetableController.js");
  assert.match(ctrl, /rooms: check\.periods\.map\(\(p\) => p\.roomName\)/);
});

// ---------------------------------------------------------------------------
// P5-B: conflict UI polish (CLIENT-REQ-015)
// ---------------------------------------------------------------------------

test("api.js attaches the 409 conflicts array to thrown errors", () => {
  const src = readFe("lib/api.js");
  assert.match(src, /if \(Array\.isArray\(body\.conflicts\)\) err\.conflicts = body\.conflicts;/);
  assert.match(src, /generate: \(payload\) => request\("\/timetable\/generate", json\("POST", payload\)\)/);
  assert.match(src, /substitutions: \{/);
});

test("TimetableManager renders 409 conflicts, room picker, and auto-generate", () => {
  const src = readFe("components/timetable/TimetableManager.jsx");
  assert.match(src, /requestError\.status === 409/);
  assert.match(src, /setConflicts\(requestError\.conflicts \|\| \[requestError\.message\]\)/);
  assert.match(src, /Scheduling conflict — nothing was saved/);
  assert.match(src, /kind="rooms"/);
  assert.match(src, /roomId: draft\.roomId \|\| ""/);
  assert.match(src, /Auto-generate/);
  assert.match(src, /runGenerate\(true\)/);
  assert.match(src, /runGenerate\(false\)/);
});

// ---------------------------------------------------------------------------
// CLIENT-REQ-018: substitution model + routes + notify
// ---------------------------------------------------------------------------

test("Substitution model: date/period identity, status flow, duplicate guard", () => {
  const src = read("../src/models/Substitution.js");
  assert.match(src, /match: \[\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/, "date must be YYYY-MM-DD"\]/);
  assert.match(src, /enum: \["scheduled", "completed", "cancelled"\]/);
  assert.match(
    src,
    /\{ schoolId: 1, date: 1, class: 1, section: 1, startTime: 1 \},\s*\{\s*unique: true\s*\}/,
  );
  assert.match(src, /originalTeacherId/);
  assert.match(src, /substituteTeacherId/);
});

test("substitution routes: read/write gates, class guard, id validation", () => {
  const src = read("../src/routes/substitutionRoutes.js");
  assert.match(src, /router\.get\("\/", requirePermission\("timetable:read"\), ctrl\.listSubstitutions\);/);
  assert.match(src, /requirePermission\("timetable:write"\),\s*scopeClassTeacher,\s*guardClassBody\(\),\s*ctrl\.createSubstitution/);
  assert.match(src, /router\.patch\("\/:id\/status", requirePermission\("timetable:write"\), ctrl\.setStatus\);/);
  assert.match(src, /router\.delete\("\/:id", requirePermission\("timetable:write"\), ctrl\.deleteSubstitution\);/);
  assert.match(src, /router\.param\("id", validateObjectIdParam\);/);
});

test("timetable routes mount substitutions before the generic :id DELETE", () => {
  const src = read("../src/routes/timetableRoutes.js");
  const mount = src.indexOf('router.use("/substitutions", substitutionRoutes);');
  const idDelete = src.indexOf('router.delete("/:id"');
  assert.ok(mount > -1 && idDelete > -1 && mount < idDelete, "substitutions must mount first");
  assert.match(src, /router\.post\("\/generate", requirePermission\("timetable:write"\), scopeClassTeacher, guardClassBody\(\), generateCtrl\.generateTimetable\);/);
});

test("substitution controller: derives the period, checks substitute availability, notifies", () => {
  const src = read("../src/controllers/substitutionController.js");
  // Period must exist in the published timetable (no drift).
  assert.match(src, /const period = \(timetable\.periods \|\| \[\]\)\.find\(/);
  assert.match(src, /That period has no teacher to substitute/);
  assert.match(src, /must differ from the original teacher/);
  // Availability: timetable clash + other substitutions, both 409.
  assert.match(src, /const timetableClashes = await findCrossClassConflicts\(\{/);
  assert.match(src, /const subClashes = otherSubs/);
  assert.match(src, /status: "scheduled",\s*substituteTeacherId: String\(substituteTeacherId\),/);
  assert.match(src, /intervalsOverlap\(o\.startTime, o\.endTime, startTime, endTime\)/);
  // Duplicate slot -> 409 via unique index.
  assert.match(src, /err && err\.code === 11000/);
  assert.match(src, /A substitution already exists for this class period/);
  // Notify substitute + class students (coverage workflow).
  assert.match(src, /notifyByRefIds\(\{\s*schoolId: req\.tenantId,\s*refIds: \[String\(substituteTeacherId\)\],\s*title: "Substitution assigned",/);
  assert.match(src, /notifyClassStudents\(\{\s*schoolId: req\.tenantId,\s*class: cls,\s*section,/);
  assert.match(src, /title: "Substitution cancelled",/);
  // Role-scoped list: teachers see involvement, parents see nothing.
  assert.match(src, /filter\.\$or = \[\{ originalTeacherId: me \}, \{ substituteTeacherId: me \}\]/);
  assert.match(src, /role === "parent"/);
});

test("notify helper is the existing internal fanout (non-fatal)", () => {
  const src = read("../src/utils/notify.js");
  assert.match(src, /async function notifyByRefIds\(\{ schoolId, refIds, title, message, kind = "system", link = null \}\)/);
  assert.match(src, /async function notifyClassStudents\(/);
});

// ---------------------------------------------------------------------------
// Auto-gen MVP (plan row: automated generation)
// ---------------------------------------------------------------------------

test("generate controller: dry-run preview, skip-existing, greedy teacher placement", () => {
  const src = read("../src/controllers/timetableGenerateController.js");
  assert.match(src, /const \{ class: cls = "", section = "", days, overwrite = false, dryRun = false \}/);
  assert.match(src, /if \(dryRun\) \{/);
  assert.match(src, /if \(existing && !overwrite\) \{/);
  assert.match(src, /TimeSlot\.find\(\{ schoolId: req\.tenantId, active: true \}\)/);
  assert.match(src, /"teacherassignments"/);
  assert.match(src, /No subject-teacher assignments found for/);
  assert.match(src, /findCrossDocConflicts\(\[candidate\], otherDocs, day\)\.length === 0/);
  // Safety net re-checks every planned day before writing anything.
  assert.match(src, /const found = await findCrossClassConflicts\(\{/);
  assert.match(src, /if \(conflicts\.length\) \{/);
  // Shared low-level helpers it depends on must stay exported.
  const shared = read("../../../shared/src/utils/teacherScope.js");
  assert.match(shared, /module\.exports = \{\s*resolveTeacherScope,/);
  assert.match(shared, /collection,/);
  assert.match(shared, /staffDbName,/);
  assert.match(shared, /resolveActiveSession,/);
  assert.match(shared, /asObjectId,/);
});

// ---------------------------------------------------------------------------
// P5-E: FE panels
// ---------------------------------------------------------------------------

test("SubstitutionPanel: create flow with 409 conflicts and status actions", () => {
  const src = readFe("components/timetable/SubstitutionPanel.jsx");
  assert.match(src, /api\.timetable\.substitutions\.create\(/);
  assert.match(src, /requestError\.status === 409/);
  assert.match(src, /substitutions\.setStatus\(id, status\)/);
  assert.match(src, /substitutions\.remove\(id\)/);
  assert.match(src, /Substitution conflict — nothing was saved/);
  assert.match(src, /dayFor/);
});

test("MySubstitutions: teacher feed via the role-scoped list endpoint", () => {
  const src = readFe("components/timetable/MySubstitutions.jsx");
  assert.match(src, /api\.timetable\.substitutions\s*\.list\(\)/);
  const page = readFe("pages/teacher/Timetable.jsx");
  assert.match(page, /<MySubstitutions \/>/);
  const admin = readFe("pages/Timetable.jsx");
  assert.match(admin, /<SubstitutionPanel cls=\{cls\} section=\{section\} canWrite=\{canWrite\} \/>/);
});

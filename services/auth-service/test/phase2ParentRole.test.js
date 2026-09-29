const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readPanel = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel", rel), "utf8");

test("parent is a first-class User role", () => {
  const user = read("../src/models/User.js");
  assert.match(user, /enum: \["super_admin", "school_admin", "teacher", "staff", "student", "parent"\]/);
  const ctrl = read("../src/controllers/authController.js");
  assert.match(ctrl, /const VALID_ROLES = \[[^\]]*"parent"\]/);
  assert.match(ctrl, /const SCHOOL_ADMIN_CREATABLE = \[[^\]]*"parent"\]/);
});

test("linkedStudentIds are validated as active same-school students", () => {
  const ctrl = read("../src/controllers/authController.js");
  assert.match(ctrl, /const cleanAndValidateLinkedStudents = async/);
  assert.match(ctrl, /studentExistsFor\(schoolId, id\)/);
  assert.match(ctrl, /At least one student must be linked to a parent account/);
  assert.match(ctrl, /links = await cleanAndValidateLinkedStudents\(schoolId, linkedStudentIds\)/);
  assert.match(ctrl, /links = await cleanAndValidateLinkedStudents\(target\.schoolId, linkedStudentIds\)/);
  assert.match(ctrl, /A parent account must stay linked to at least one student/);
  assert.match(ctrl, /linkedStudentIds: links\.ids/);
});

test("parent role resolves a read-only child-view permission bundle", () => {
  const shared = read("../../../shared/src/utils/permissions.js");
  const parent = shared.match(/parent: \[([\s\S]*?)\],/);
  assert.ok(parent, "ROLE_PERMISSIONS.parent exists");
  assert.match(parent[1], /dashboard:view/);
  assert.match(parent[1], /attendance:read/);
  assert.match(parent[1], /marks:read/);
  assert.ok(!parent[1].includes("students:"), "parent must not get students:*");
  assert.ok(!parent[1].includes("health:"), "parent must not get health:*");
  assert.ok(!parent[1].includes("profile:"), "parent must not get profile:*");
  assert.ok(!parent[1].includes("users:manage"), "parent must not manage users");
  const fe = readPanel("src/lib/permissions.js");
  const feParent = fe.match(/parent: \[([\s\S]*?)\],/);
  assert.ok(feParent, "FE mirror defines parent");
  assert.match(feParent[1], /marks:read/);
});

test("parent accounts are visible to the getStudents parent scope", () => {
  const ctrl = read("../../student-service/src/controllers/studentController.js");
  assert.match(ctrl, /if \(req\.user\.role === "parent"\)\s*\n\s*filter\.admissionNo = \{ \$in: req\.user\.linkedStudentIds \|\| \[\] \};/);
  const jwt = read("../src/utils/generateToken.js");
  assert.match(jwt, /linkedStudentIds/);
});

test("Users page lets a school admin create Parent accounts with student links", () => {
  const src = readPanel("src/pages/Users.jsx");
  assert.match(src, /parent: "Parent"/);
  assert.match(src, /const CREATABLE_ROLES = \[[^\]]*"parent"\]/);
  assert.match(src, /linkedStudentIds: \[\]/);
  assert.match(src, /form\.role === "parent" \? form\.linkedStudentIds : undefined/);
  assert.match(src, /Link at least one student to a parent account/);
  assert.match(src, /Linked students/);
  assert.match(src, /studentLinkOptions/);
});

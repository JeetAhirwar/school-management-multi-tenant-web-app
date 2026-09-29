const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readPanel = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel", rel), "utf8");

test("health record carries immunizations through the write allowlist", () => {
  const model = read("../src/models/StudentHealthRecord.js");
  assert.match(model, /immunizations: \[\{ type: String, trim: true \}\]/);
  const ctrl = read("../src/controllers/healthController.js");
  assert.match(ctrl, /HEALTH_WRITABLE_FIELDS = \[[\s\S]*"immunizations",/);
  assert.match(ctrl, /pickHealthFields/);
});

test("health routes gate on health:read/health:write, students keep profile gates", () => {
  const src = read("../src/routes/healthRoutes.js");
  assert.match(src, /req\.user\?\.role === "student" \? "profile:read" : "health:read"/);
  assert.match(src, /req\.user\?\.role === "student" \? "profile:update" : "health:write"/);
  assert.doesNotMatch(src, /: "students:read"/);
  assert.doesNotMatch(src, /: "students:write"/);
  assert.match(src, /scopeClassTeacher/);
});

test("health permissions exist in the shared RBAC map and the FE mirror", () => {
  const shared = read("../../../shared/src/utils/permissions.js");
  assert.match(shared, /"health:read", "health:write"/);
  // Counsellor bundle keeps students:* but must NOT reach medical data.
  const counsellor = shared.match(/admission_counsellor: \[([\s\S]*?)\],/);
  assert.ok(counsellor, "counsellor bundle exists");
  assert.ok(!counsellor[1].includes("health:"), "counsellor must not have health permissions");
  const fe = readPanel("src/lib/permissions.js");
  assert.match(fe, /"health:read", "health:write"/);
});

test("HealthTab edits immunizations alongside allergies/conditions", () => {
  const src = readPanel("src/pages/teacher/StudentDetailModal.jsx");
  assert.match(src, /Immunizations \(comma separated\)/);
  assert.match(src, /setArray\("immunizations"\)/);
  assert.match(src, /health\.immunizations\?\.length > 0/);
  assert.match(src, /api\.health\.upsert/);
});

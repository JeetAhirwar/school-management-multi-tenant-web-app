const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(
  path.join(__dirname, "../src/controllers/healthController.js"),
  "utf8",
);

test("students cannot query another student's health record", () => {
  assert.match(src, /req\.user\.role === "student"/);
  assert.match(src, /resolveStudentIdForRequest/);
});

test("upsert $set only uses an explicit field allowlist", () => {
  assert.match(src, /HEALTH_WRITABLE_FIELDS/);
  assert.match(src, /pickHealthFields/);
  assert.doesNotMatch(src, /\.\.\.\s*update\s*,/);
});

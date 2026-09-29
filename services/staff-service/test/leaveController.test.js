const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Student leave approval used to Staff.findById(leave.staffId) where
// staffId held an admissionNo/refId → CastError. Lock the branch guard.
const src = fs.readFileSync(
  path.join(__dirname, "../src/controllers/leaveController.js"),
  "utf8",
);

test("applyLeave never writes student refId into staffId", () => {
  assert.match(src, /const staffId = isStudent\s*\?\s*undefined/);
  assert.match(src, /const studentId = isStudent \? req\.user\.refId : undefined/);
  assert.doesNotMatch(src, /staffId:\s*staffId \|\| studentId/);
});

test("updateLeaveStatus branches on studentId before Staff.findById", () => {
  assert.match(src, /if \(leave\.studentId\)/);
  assert.match(src, /mongoose\.isValidObjectId\(leave\.staffId\)/);
});

test("Leave.studentId is String (admissionNo), not ObjectId", () => {
  const model = fs.readFileSync(
    path.join(__dirname, "../src/models/Leave.js"),
    "utf8",
  );
  assert.match(model, /studentId:\s*\{\s*type:\s*String/);
});

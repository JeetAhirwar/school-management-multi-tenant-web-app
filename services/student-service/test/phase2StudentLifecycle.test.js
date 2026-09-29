const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

test("Student model soft-deletes with a partial unique admissionNo index", () => {
  const src = read("../src/models/Student.js");
  assert.match(src, /deletedAt:\s*\{\s*type: Date,\s*default: null\s*\}/);
  assert.match(
    src,
    /unique:\s*true,\s*partialFilterExpression:\s*\{\s*deletedAt:\s*\{\s*\$exists:\s*false\s*\}\s*\}/,
  );
  assert.match(src, /\{\s*schoolId:\s*1,\s*admissionNo:\s*1\s*\}/);
});

test("deleteStudent soft-deletes and cascades to the auth login", () => {
  const src = read("../src/controllers/studentController.js");
  assert.match(src, /student\.deletedAt = new Date\(\);/);
  assert.match(src, /student\.save\(\);/);
  assert.match(src, /deactivateStudentUser\(\{ schoolId: req\.tenantId, admissionNo: student\.admissionNo \}\)/);
  assert.doesNotMatch(src, /await Student\.deleteOne\(\{ _id: student\._id \}\);/);
});

test("restoreStudent guards the reused admissionNo slot", () => {
  const src = read("../src/controllers/studentController.js");
  assert.match(src, /const restoreStudent = async/);
  assert.match(src, /if \(!student\.deletedAt\)/);
  assert.match(src, /Cannot restore/);
  assert.match(src, /student\.deletedAt = null;/);
  assert.match(src, /module\.exports = \{[\s\S]*restoreStudent[\s\S]*\}/);
});

test("listings, stats, pending and internal queries exclude deleted students", () => {
  const src = read("../src/controllers/studentController.js");
  assert.match(src, /if \(includeDeleted !== "true" && includeDeleted !== "1"\) filter\.deletedAt = null;/);
  assert.match(src, /const base = \{ schoolId: req\.tenantId, deletedAt: null \};/);
  assert.match(src, /userId: null,\s*deletedAt: null,/);
  assert.match(src, /if \(student\.deletedAt\) \{/);
  const internal = read("../src/routes/internalRoutes.js");
  assert.match(internal, /deletedAt: null/);
});

test("purge job enforces retention before hard-deleting owned data", () => {
  const src = read("../src/jobs/purgeDeletedStudents.js");
  assert.match(src, /STUDENT_SOFT_DELETE_RETENTION_DAYS/);
  assert.match(src, /deletedAt: \{ \$ne: null, \$lte: cutoff \}/);
  assert.match(src, /StudentHealthRecord\.deleteMany/);
  assert.match(src, /StudentDocument\.deleteMany/);
  assert.match(src, /purgeStudentUser/);
  assert.match(src, /Student\.deleteOne/);
  assert.match(src, /dryRun/);
  const idx = read("../src/index.js");
  assert.match(idx, /startPurgeJob\(\)/);
  assert.match(idx, /Student\.syncIndexes\(\)/);
});

test("auth cascade utility only talks through the internal key", () => {
  const src = read("../src/utils/authCascade.js");
  assert.match(src, /INTERNAL_NOTIFY_KEY/);
  assert.match(src, /X-Internal-Key/);
  assert.match(src, /deactivate-by-student/);
  assert.match(src, /purge-by-student/);
  assert.match(src, /catch \(err\)/);
});

test("enquiry shell creation is race-safe and degrades duplicates to 409", () => {
  const src = read("../src/controllers/enquiryController.js");
  assert.match(src, /const isDuplicateKey/);
  assert.match(src, /deletedAt: null/);
  assert.match(src, /\.status\(409\)/);
  assert.match(src, /created: false/);
});

test("auth-service student lookups skip deleted students", () => {
  const src = read("../../auth-service/src/controllers/authController.js");
  assert.match(src, /Student\.findOne\(\{ schoolId, admissionNo: admissionId, deletedAt: null \}\)/);
  assert.match(src, /Student\.findOne\(\{ schoolId, admissionNo, deletedAt: null \}\)/);
  assert.match(src, /cleanAndValidateLinkedStudents/);
});

test("auth internal routes expose the student cascade behind internalGuard", () => {
  const src = read("../../auth-service/src/routes/internalRoutes.js");
  assert.match(src, /router\.use\(internalGuard\)/);
  assert.match(src, /\/users\/deactivate-by-student/);
  assert.match(src, /\/users\/purge-by-student/);
});

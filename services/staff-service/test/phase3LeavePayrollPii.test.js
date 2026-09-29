const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

const leaveCtrl = read("../src/controllers/leaveController.js");
const staffNotify = read("../src/utils/notify.js");
const staffCtrl = read("../src/controllers/staffController.js");
const payrollCtrl = read("../src/controllers/payrollController.js");
const payrollModel = read("../src/models/Payroll.js");
const {
  calcNetPay,
  daysInMonth,
  monthToNumber,
  dateRange,
  attendanceAdjustment,
} = require("../src/utils/payrollMath");

// ---------------------------------------------------------------------------
// P3-A: student leave approval notification (CLIENT-REQ-010)
// ---------------------------------------------------------------------------

test("student leave approval notifies via the internal push-by-refs channel", () => {
  assert.match(staffNotify, /async function notifyByRefIds\(/);
  assert.match(staffNotify, /\/api\/notifications\/internal\/push-by-refs/);
  assert.match(staffNotify, /"X-Internal-Key": INTERNAL_KEY/);
  assert.match(staffNotify, /module\.exports = \{ pushNotifications, notifyByRefIds \}/);
  assert.match(leaveCtrl, /const \{ pushNotifications, notifyByRefIds \} = require\("\.\.\/utils\/notify"\);/);
  assert.match(leaveCtrl, /await notifyByRefIds\(\{/);
  assert.match(leaveCtrl, /refIds: \[leave\.studentId\]/);
  assert.match(leaveCtrl, /link: "\/student\/leave"/);
});

test("dead Student-model notify branch is gone (model is never registered in staff-service)", () => {
  assert.doesNotMatch(leaveCtrl, /mongoose\.models\.Student/);
  assert.match(leaveCtrl, /if \(leave\.staffId && mongoose\.isValidObjectId\(leave\.staffId\)\)/);
});

// ---------------------------------------------------------------------------
// P3-B: student leave type permissions (CLIENT-REQ-010)
// ---------------------------------------------------------------------------

test("students may only apply for Sick / Casual / Other leave", () => {
  assert.match(leaveCtrl, /const STUDENT_LEAVE_TYPES = \["Sick", "Casual", "Other"\];/);
  assert.match(leaveCtrl, /if \(payload\.leaveType !== undefined && !STUDENT_LEAVE_TYPES\.includes\(payload\.leaveType\)\)/);
  assert.match(leaveCtrl, /Students may only apply for Sick, Casual or Other leave/);
  assert.match(leaveCtrl, /res\.status\(400\)/);
});

test("student applicants cannot set the admin remarks field", () => {
  assert.match(leaveCtrl, /if \(isStudent\) \{\s*delete payload\.remarks;/);
  const student = read("../../../../Admin-panel/src/pages/student/Leave.jsx");
  assert.match(student, /leaveType: form\.type/);
  assert.doesNotMatch(student, /type: form\.type/);
  assert.doesNotMatch(student, /adminComment/);
  assert.match(student, /r\.remarks/);
});

// ---------------------------------------------------------------------------
// P3-C: salary PII scoping (CLIENT-REQ-008)
// ---------------------------------------------------------------------------

test("staff list omits salary for every non-admin role", () => {
  assert.match(staffCtrl, /const isAdminRole = \["school_admin", "super_admin"\]\.includes\(req\.user\.role\);/);
  assert.match(staffCtrl, /\.select\(isAdminRole \? undefined : "-salary"\)/);
});

test("missing refId never degrades into an unscoped staff/payroll query", () => {
  // mongoose drops undefined filters — a broken link must return empty, not everyone's data.
  assert.match(staffCtrl, /if \(!req\.user\.refId\) \{\s*return res\.json\(\{ success: true, count: 0, total: 0, \.\.\.pageInfo\(0, page, limit\), data: \[\] \}\);/);
  assert.match(payrollCtrl, /if \(!req\.user\.refId\) \{\s*return res\.json\(\{ success: true, count: 0, total: 0, \.\.\.pageInfo\(0, page, limit\), data: \[\] \}\);/);
});

// ---------------------------------------------------------------------------
// P3-D: payroll ↔ attendance linkage + staffId tenant validation (CLIENT-REQ-009)
// ---------------------------------------------------------------------------

test("generatePayroll validates staffId belongs to the acting school", () => {
  assert.match(payrollCtrl, /if \(!mongoose\.isValidObjectId\(staffId\)\)/);
  assert.match(payrollCtrl, /Staff\.findOne\(\{ _id: staffId, schoolId: req\.tenantId \}\)/);
  assert.match(payrollCtrl, /"Staff member not found"/);
  assert.match(payrollCtrl, /res\.status\(404\)/);
});

test("markPaid resolves the staff record inside the school too", () => {
  assert.match(payrollCtrl, /Staff\.findOne\(\{ _id: payroll\.staffId, schoolId: req\.tenantId \}\)/);
});

test("attendance adjustment is opt-in and queries attendance for the payroll period", () => {
  assert.match(payrollCtrl, /adjustForAttendance = false/);
  assert.match(payrollCtrl, /const records = range\s*\?\s*await StaffAttendance\.find\(\{[\s\S]*?schoolId: req\.tenantId,[\s\S]*?staffId: String\(staffId\),[\s\S]*?date: \{ \$gte: range\.gte, \$lte: range\.lte \}/);
  assert.match(payrollCtrl, /attendanceAdjustment\(\{ basic, month, year, records/);
  assert.match(payrollCtrl, /attendanceDeduction: totals\.attendanceDeduction/);
  assert.match(payrollCtrl, /attendancePct: totals\.attendancePct/);
});

test("bulk generation fetches attendance once per school period", () => {
  assert.match(payrollCtrl, /const \{ month, year, adjustForAttendance = false \} = req\.body;/);
  assert.match(payrollCtrl, /StaffAttendance\.find\(\{\s*schoolId: req\.tenantId,\s*date: \{ \$gte: range\.gte, \$lte: range\.lte \},\s*\}\)\.select\("staffId status"\)/);
  assert.match(payrollCtrl, /netPay: calcNetPay\(s\.salary \|\| 0, 0, deductions\)/);
});

test("manual payroll edits reset the generated attendance transparency fields", () => {
  assert.match(payrollCtrl, /\{ basic, allowances, deductions, deductionReason, attendanceDeduction: 0, attendancePct: null, netPay \}/);
});

test("Payroll model persists attendance linkage fields", () => {
  assert.match(payrollModel, /attendanceDeduction:\s*\{\s*type: Number,\s*default: 0\s*\}/);
  assert.match(payrollModel, /attendancePct:\s*\{\s*type: Number,\s*default: null\s*\}/);
});

// ---------------------------------------------------------------------------
// Pure math: gross → net and attendance adjustment (CLIENT-REQ-009 test)
// ---------------------------------------------------------------------------

test("gross → net: net = basic + allowances − deductions", () => {
  assert.strictEqual(calcNetPay(50000, 5000, 2000), 53000);
  assert.strictEqual(calcNetPay("40000", "1000", "500"), 40500);
  assert.strictEqual(calcNetPay(30000), 30000);
  assert.strictEqual(calcNetPay(0, 0, 0), 0);
});

test("attendance adjustment: Absent = 1 day, Half Day = 0.5, others free", () => {
  const records20 = [
    ...Array(18).fill({ status: "Present" }),
    { status: "Absent" },
    { status: "Absent" },
  ];
  assert.deepStrictEqual(
    attendanceAdjustment({ basic: 30000, month: "September", year: 2026, records: records20 }),
    { attendanceDeduction: 2000, attendancePct: 90, penaltyDays: 2 },
  );

  const half = [
    ...Array(3).fill({ status: "Present" }),
    { status: "Half Day" },
  ];
  assert.deepStrictEqual(
    attendanceAdjustment({ basic: 31000, month: "May", year: 2026, records: half }),
    { attendanceDeduction: 500, attendancePct: 88, penaltyDays: 0.5 },
  );

  // Leave / Late / Present carry no penalty.
  const free = [{ status: "Leave" }, { status: "Late" }, { status: "Present" }];
  assert.deepStrictEqual(
    attendanceAdjustment({ basic: 30000, month: "September", year: 2026, records: free }),
    { attendanceDeduction: 0, attendancePct: 100, penaltyDays: 0 },
  );
});

test("no attendance records for the period means no deduction", () => {
  assert.deepStrictEqual(
    attendanceAdjustment({ basic: 30000, month: "September", year: 2026, records: [] }),
    { attendanceDeduction: 0, attendancePct: null, penaltyDays: 0 },
  );
});

test("payroll period helpers resolve month names and date ranges", () => {
  assert.strictEqual(monthToNumber("april"), 4);
  assert.strictEqual(monthToNumber("September"), 9);
  assert.strictEqual(monthToNumber("Nope"), null);
  assert.strictEqual(daysInMonth("February", 2024), 29);
  assert.strictEqual(daysInMonth("February", 2026), 28);
  assert.deepStrictEqual(dateRange("September", 2026), { gte: "2026-09-01", lte: "2026-09-30" });
  assert.deepStrictEqual(dateRange("Bad", 2026), null);
});

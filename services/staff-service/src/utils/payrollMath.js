// Pure payroll math shared by the payroll controller and the phase-3 tests.
// No I/O — safe to require from anywhere.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const monthToNumber = (month) => {
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === String(month || "").toLowerCase());
  return idx === -1 ? null : idx + 1;
};

const daysInMonth = (month, year) => {
  const mm = monthToNumber(month);
  if (!mm || !year) return null;
  return new Date(Number(year), mm, 0).getDate();
};

// Inclusive YYYY-MM-DD range covering the payroll month (StaffAttendance.date
// is a YYYY-MM-DD string).
const dateRange = (month, year) => {
  const mm = monthToNumber(month);
  if (!mm || !year) return null;
  const dim = daysInMonth(month, year);
  const pad = (n) => String(n).padStart(2, "0");
  return { gte: `${year}-${pad(mm)}-01`, lte: `${year}-${pad(mm)}-${pad(dim)}` };
};

// Gross → net: basic + allowances − deductions.
const calcNetPay = (basic, allowances = 0, deductions = 0) =>
  Number(basic) + Number(allowances) - Number(deductions);

// Attendance adjustment (opt-in). Penalty weighting: Absent = 1 day,
// Half Day = 0.5 day; Present / Late / Leave are not penalised.
// No attendance records for the period → no deduction (untracked ≠ absent).
const attendanceAdjustment = ({ basic, month, year, records = [] }) => {
  if (!records.length) return { attendanceDeduction: 0, attendancePct: null, penaltyDays: 0 };
  let penaltyDays = 0;
  for (const r of records) {
    if (r.status === "Absent") penaltyDays += 1;
    else if (r.status === "Half Day") penaltyDays += 0.5;
  }
  const dim = daysInMonth(month, year);
  const attendancePct = Math.round(((records.length - penaltyDays) / records.length) * 100);
  const attendanceDeduction = dim ? Math.round((Number(basic) / dim) * penaltyDays) : 0;
  return { attendanceDeduction, attendancePct, penaltyDays };
};

module.exports = { MONTH_NAMES, monthToNumber, daysInMonth, dateRange, calcNetPay, attendanceAdjustment };

const mongoose = require("mongoose");
const Payroll = require("../models/Payroll");
const Staff = require("../models/Staff");
const StaffAttendance = require("../models/StaffAttendance");
const { pushNotifications } = require("../utils/notify");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { calcNetPay, attendanceAdjustment, dateRange } = require("../utils/payrollMath");

// Folds the opt-in attendance deduction into the payable totals and appends
// the attendance reason alongside any manual deduction reason.
const applyAttendance = ({ basic, month, year, records, baseDeductions, deductionReason }) => {
  const adj = attendanceAdjustment({ basic, month, year, records });
  const deductions = Number(baseDeductions) + adj.attendanceDeduction;
  const reason =
    adj.attendanceDeduction > 0
      ? [deductionReason || "", `Attendance: ${adj.penaltyDays} day(s) short`].filter(Boolean).join("; ")
      : deductionReason || "";
  return { deductions, deductionReason: reason, attendanceDeduction: adj.attendanceDeduction, attendancePct: adj.attendancePct };
};

const generatePayroll = async (req, res) => {
  try {
    const {
      staffId, month, year, basic, allowances = 0, deductions = 0,
      deductionReason = "", adjustForAttendance = false,
    } = req.body;

    // staffId tenant validation: the referenced Staff must exist inside THIS
    // school — never attach payroll (salary data) to a foreign staff record.
    if (!mongoose.isValidObjectId(staffId)) {
      return res.status(400).json({ success: false, message: "staffId must reference a real staff member" });
    }
    const staff = await Staff.findOne({ _id: staffId, schoolId: req.tenantId }).select("_id").lean();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }

    let totals = {
      deductions: Number(deductions),
      deductionReason: deductionReason || "",
      attendanceDeduction: 0,
      attendancePct: null,
    };
    if (adjustForAttendance) {
      const range = dateRange(month, year);
      const records = range
        ? await StaffAttendance.find({
            schoolId: req.tenantId,
            staffId: String(staffId),
            date: { $gte: range.gte, $lte: range.lte },
          }).select("status").lean()
        : [];
      totals = applyAttendance({ basic, month, year, records, baseDeductions: deductions, deductionReason });
    }

    const netPay = calcNetPay(basic, allowances, totals.deductions);
    const payroll = await Payroll.create({
      staffId,
      month,
      year,
      basic,
      allowances,
      deductions: totals.deductions,
      deductionReason: totals.deductionReason,
      attendanceDeduction: totals.attendanceDeduction,
      attendancePct: totals.attendancePct,
      netPay,
      schoolId: req.tenantId,
    });
    res.status(201).json({ success: true, data: payroll });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getPayroll = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    const { page, limit, skip } = paginate(req.query);

    if (["teacher", "staff"].includes(req.user.role)) {
      // Guard: an unlinked account (refId missing) must not degrade into an
      // unscoped find() — mongoose silently drops undefined filters, which
      // would enumerate every payroll record (salary PII) in the school.
      if (!req.user.refId) {
        return res.json({ success: true, count: 0, total: 0, ...pageInfo(0, page, limit), data: [] });
      }
      filter.staffId = req.user.refId;
    }
    if (req.query.month) filter.month = req.query.month;
    if (req.query.year) filter.year = req.query.year;
    const [records, total] = await Promise.all([
      Payroll.find(filter).sort({ year: -1, createdAt: -1 }).skip(skip).limit(limit),
      Payroll.countDocuments(filter),
    ]);
    res.json({ success: true, count: records.length, total, ...pageInfo(total, page, limit), data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const markPaid = async (req, res) => {
  try {
    const payroll = await Payroll.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { status: "Paid", paidOn: new Date() },
      { new: true },
    );
    if (!payroll) return res.status(404).json({ success: false, message: "Payroll record not found" });

    const staff = await Staff.findOne({ _id: payroll.staffId, schoolId: req.tenantId })
      .select("userId employeeId name")
      .lean();
    if (staff?.userId) {
      pushNotifications({
        token: req.token,
        schoolId: req.tenantId,
        userIds: [staff.userId],
        title: "Salary Released",
        message: `Salary for ${payroll.month} ${payroll.year} (${staff.employeeId || "—"}) has been paid.`,
        kind: "payroll",
        link: "/payroll",
      });
    }
    return res.json({ success: true, data: payroll });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

const generateAllPayroll = async (req, res) => {
  try {
    const { month, year, adjustForAttendance = false } = req.body;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: "month and year are required" });
    }

    const activeStaff = await Staff.find({ schoolId: req.tenantId, status: "Active" })
      .select("employeeId name salary")
      .lean();

    if (!activeStaff.length) {
      return res.status(200).json({ success: true, data: { created: 0, skipped: 0, message: "No active staff found" } });
    }

    const existing = await Payroll.find({
      schoolId: req.tenantId,
      month,
      year: Number(year),
    })
      .select("staffId")
      .lean();

    const existingIds = new Set(existing.map((p) => String(p.staffId)));

    // One school-wide attendance fetch for the period, grouped per staff.
    const attendanceByStaff = new Map();
    if (adjustForAttendance) {
      const range = dateRange(month, year);
      if (range) {
        const rows = await StaffAttendance.find({
          schoolId: req.tenantId,
          date: { $gte: range.gte, $lte: range.lte },
        }).select("staffId status").lean();
        for (const r of rows) {
          const key = String(r.staffId);
          if (!attendanceByStaff.has(key)) attendanceByStaff.set(key, []);
          attendanceByStaff.get(key).push({ status: r.status });
        }
      }
    }

    const toCreate = activeStaff
      .filter((s) => !existingIds.has(String(s._id)) && (s.salary || 0) > 0)
      .map((s) => {
        const records = attendanceByStaff.get(String(s._id)) || [];
        const adj = adjustForAttendance
          ? attendanceAdjustment({ basic: s.salary || 0, month, year, records })
          : { attendanceDeduction: 0, attendancePct: null, penaltyDays: 0 };
        const deductions = adj.attendanceDeduction;
        return {
          schoolId: req.tenantId,
          staffId: s._id,
          month,
          year: Number(year),
          basic: s.salary || 0,
          allowances: 0,
          deductions,
          deductionReason: deductions > 0 ? `Attendance: ${adj.penaltyDays} day(s) short` : "",
          attendanceDeduction: deductions,
          attendancePct: adj.attendancePct,
          netPay: calcNetPay(s.salary || 0, 0, deductions),
        };
      });

    let created = 0;
    if (toCreate.length) {
      const result = await Payroll.insertMany(toCreate, { ordered: false }).catch(() => ({ insertedCount: 0 }));
      created = result.insertedCount || toCreate.length;
    }

    res.status(201).json({
      success: true,
      data: { created, skipped: existingIds.size, total: activeStaff.length },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updatePayroll = async (req, res) => {
  try {
    const { basic, allowances = 0, deductions = 0, deductionReason = "" } = req.body;
    const netPay = calcNetPay(basic, allowances, deductions);
    // Manual edit overrides any generated attendance adjustment — reset the
    // transparency fields so they never contradict the edited totals.
    const payroll = await Payroll.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId, status: "Pending" },
      { basic, allowances, deductions, deductionReason, attendanceDeduction: 0, attendancePct: null, netPay },
      { new: true },
    );
    if (!payroll) return res.status(404).json({ success: false, message: "Payroll record not found or already paid" });
    res.json({ success: true, data: payroll });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { generatePayroll, generateAllPayroll, getPayroll, updatePayroll, markPaid };

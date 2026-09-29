const mongoose = require("mongoose");
const StaffAttendance = require("../models/StaffAttendance");
const Staff = require("../models/Staff");

const VALID_STATUSES = ["Present", "Absent", "Leave", "Late", "Half Day"];

const markAttendance = async (req, res) => {
  try {
    const { staffId, date, status, checkIn, checkOut, note } = req.body;
    if (!date || !status) {
      return res.status(400).json({ success: false, message: "date and status are required" });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    const isSelf = req.user.role === "staff" || req.user.role === "teacher";
    const targetStaffId = isSelf ? req.user.refId : staffId;
    if (!targetStaffId) {
      return res.status(400).json({ success: false, message: "No staff record linked to this account" });
    }
    if (req.user.role === "school_admin" || req.user.role === "super_admin") {
      if (!mongoose.isValidObjectId(targetStaffId)) {
        return res.status(400).json({ success: false, message: "staffId must reference a real staff member" });
      }
      const exists = await Staff.findOne({ _id: targetStaffId, schoolId: req.tenantId }).select("_id").lean();
      if (!exists) {
        return res.status(400).json({ success: false, message: "No staff record found for this school" });
      }
    }
    const record = await StaffAttendance.findOneAndUpdate(
      { schoolId: req.tenantId, staffId: targetStaffId, date },
      {
        $set: {
          status,
          checkIn: checkIn || null,
          checkOut: checkOut || null,
          note: note || null,
          markedBy: req.user.refId || req.user.name || req.user.id,
          source: isSelf ? "self" : "admin",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getAttendance = async (req, res) => {
  try {
    const { staffId, date, status, page = 1, limit = 50 } = req.query;
    const filter = { schoolId: req.tenantId };
    if (req.user.role === "staff" || req.user.role === "teacher") {
      filter.staffId = req.user.refId;
    } else if (staffId) {
      filter.staffId = staffId;
    }
    if (date) filter.date = date;
    if (status) filter.status = status;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(2000, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (p - 1) * l;

    const [data, total] = await Promise.all([
      StaffAttendance.find(filter).sort({ date: -1 }).skip(skip).limit(l),
      StaffAttendance.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, page: p, limit: l, pages: Math.ceil(total / l), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyToday = async (req, res) => {
  try {
    const staffId = req.user.refId;
    if (!staffId) {
      return res.status(400).json({ success: false, message: "No staff record linked to this account" });
    }
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    const today = local.toISOString().slice(0, 10);

    const record = await StaffAttendance.findOne({
      schoolId: req.tenantId,
      staffId,
      date: today,
    }).lean();

    res.json({ success: true, data: record || null, date: today });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getTodayAll = async (req, res) => {
  try {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    const today = local.toISOString().slice(0, 10);

    const records = await StaffAttendance.find({
      schoolId: req.tenantId,
      date: today,
    }).lean();

    const allStaff = await Staff.find({ schoolId: req.tenantId, status: "Active" })
      .select("name designation role userId")
      .lean();

    const attendanceMap = {};
    records.forEach((r) => { attendanceMap[r.staffId] = r; });

    const staffList = allStaff.map((s) => ({
      _id: s._id,
      name: s.name,
      designation: s.designation,
      role: s.role,
      userId: s.userId,
      attendance: attendanceMap[String(s._id)] || null,
    }));

    const teachers = staffList.filter((s) => s.role === "teacher");
    const classTeachers = teachers.filter((s) => {
      const att = s.attendance;
      return att;
    });
    const otherStaff = staffList.filter((s) => s.role !== "teacher");

    const countByGroup = (list) => {
      const present = list.filter((s) => s.attendance && ["Present", "Late"].includes(s.attendance.status)).length;
      const absent = list.filter((s) => s.attendance && s.attendance.status === "Absent").length;
      const notMarked = list.filter((s) => !s.attendance).length;
      return { total: list.length, present, absent, notMarked };
    };

    res.json({
      success: true,
      date: today,
      summary: {
        teachers: countByGroup(teachers),
        otherStaff: countByGroup(otherStaff),
        total: countByGroup(staffList),
      },
      data: staffList,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const { month, year, staffId } = req.query;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: "month and year are required" });
    }
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    if (isNaN(monthNum) || isNaN(yearNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ success: false, message: "Invalid month or year" });
    }
    const monthStr = String(monthNum).padStart(2, "0");
    const datePrefix = `${yearNum}-${monthStr}`;

    const filter = {
      schoolId: req.tenantId,
      date: { $regex: `^${datePrefix}` },
    };
    if (staffId) {
      filter.staffId = staffId;
    } else if (req.user.role === "staff" || req.user.role === "teacher") {
      filter.staffId = req.user.refId;
    }

    const records = await StaffAttendance.find(filter).lean();

    const staffFilter = { schoolId: req.tenantId, status: "Active" };
    if (staffId) {
      staffFilter._id = staffId;
    } else if (req.user.role === "staff" || req.user.role === "teacher") {
      staffFilter._id = req.user.refId;
    }
    const staffList = await Staff.find(staffFilter).select("name designation role employeeId").lean();

    const byStaff = {};
    records.forEach((r) => {
      if (!byStaff[r.staffId]) byStaff[r.staffId] = [];
      byStaff[r.staffId].push(r);
    });

    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const summary = staffList.map((s) => {
      const recs = byStaff[String(s._id)] || [];
      const counts = {};
      recs.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
      const present = (counts["Present"] || 0) + (counts["Late"] || 0);
      const paid = present + (counts["Leave"] || 0) + (counts["Half Day"] || 0);
      return {
        staffId: s._id,
        name: s.name,
        designation: s.designation,
        role: s.role,
        employeeId: s.employeeId,
        present: counts["Present"] || 0,
        late: counts["Late"] || 0,
        absent: counts["Absent"] || 0,
        leave: counts["Leave"] || 0,
        halfDay: counts["Half Day"] || 0,
        totalDays: daysInMonth,
        recordedDays: recs.length,
        attendancePct: recs.length > 0 ? Math.round((paid / daysInMonth) * 1000) / 10 : 0,
      };
    });

    res.json({ success: true, month: monthNum, year: yearNum, daysInMonth, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const correctAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason, checkIn, checkOut, note } = req.body;
    if (!status || !reason) {
      return res.status(400).json({ success: false, message: "status and reason are required" });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    const record = await StaffAttendance.findOne({ _id: id, schoolId: req.tenantId });
    if (!record) {
      return res.status(404).json({ success: false, message: "Attendance record not found" });
    }
    record.originalStatus = record.status;
    record.status = status;
    if (checkIn !== undefined) record.checkIn = checkIn || null;
    if (checkOut !== undefined) record.checkOut = checkOut || null;
    if (note !== undefined) record.note = note || null;
    record.correctedBy = req.user.name || req.user.id;
    record.correctedAt = new Date();
    record.correctionReason = reason;
    await record.save();
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { markAttendance, getAttendance, getMyToday, getTodayAll, getMonthlySummary, correctAttendance };

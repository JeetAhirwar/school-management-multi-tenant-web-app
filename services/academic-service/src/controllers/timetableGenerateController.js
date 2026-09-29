// Automated timetable generation MVP.
//
// Greedy round-robin: for each requested day it walks the school's active
// TimeSlot master and places the class's teaching assignments (subject +
// teacher) slot by slot, skipping teachers who are already booked against any
// other class of the school for that interval. Slots with no free teacher get
// the subject placed WITHOUT a teacher (admin can assign manually later).
//
// POST /api/timetable/generate  { class, section, days?, overwrite?, dryRun? }
// dryRun  -> returns the computed plan without writing
// overwrite=false (default) -> days that already have a timetable are skipped

const Timetable = require("../models/Timetable");
const TimeSlot = require("../models/TimeSlot");
const {
  collection,
  staffDbName,
  resolveActiveSession,
  asObjectId,
} = require("@school-erp/shared/src/utils/teacherScope");
const { findCrossClassConflicts } = require("../utils/periodConflicts");
const { findCrossDocConflicts, findIntraDayOverlaps, TIME_RE } = require("../utils/periodConflictLib");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Active teaching assignments of the tenant read straight from the staff DB
// collection (same access pattern shared/src/utils/teacherScope uses).
async function loadTeachingAssignments(schoolId) {
  const schoolOid = asObjectId(schoolId);
  if (!schoolOid) return [];
  const assignments = await collection(staffDbName(), "teacherassignments");
  const base = { schoolId: schoolOid, status: "active", type: "teaching" };
  const session = await resolveActiveSession(schoolId);
  if (session) base.session = String(session);
  const rows = await assignments.find(base).toArray();
  return rows
    .map((r) => ({
      class: String(r.class || ""),
      section: String(r.section || ""),
      subject: r.subject ? String(r.subject) : null,
      teacherId: String(r.staffId || ""),
      teacherName: String(r.staffName || ""),
    }))
    .filter((a) => a.class && a.section && a.subject && a.teacherId);
}

const generateTimetable = async (req, res) => {
  try {
    const { class: cls = "", section = "", days, overwrite = false, dryRun = false } = req.body || {};

    if (!cls || !section) {
      return res.status(400).json({ success: false, message: "class and section are required" });
    }
    const requestedDays =
      Array.isArray(days) && days.length
        ? DAYS.filter((d) => days.includes(d))
        : [...DAYS];
    if (!requestedDays.length) {
      return res
        .status(400)
        .json({ success: false, message: `days must include at least one of: ${DAYS.join(", ")}` });
    }

    const slots = await TimeSlot.find({ schoolId: req.tenantId, active: true })
      .sort({ startTime: 1 })
      .lean();
    if (!slots.length) {
      return res.status(400).json({
        success: false,
        message: "No active time slots configured. Add school time slots first (Exam Masters -> Time Slots).",
      });
    }
    if (slots.some((s) => !TIME_RE.test(s.startTime) || !TIME_RE.test(s.endTime) || s.endTime <= s.startTime)) {
      return res.status(400).json({ success: false, message: "A configured time slot has invalid times" });
    }
    const slotOverlap = findIntraDayOverlaps(
      slots.map((s) => ({ subject: s.label, startTime: s.startTime, endTime: s.endTime }))
    );
    if (slotOverlap.length) {
      return res
        .status(409)
        .json({ success: false, message: "Configured time slots conflict with each other", conflicts: slotOverlap });
    }

    const assignments = (await loadTeachingAssignments(req.tenantId)).filter(
      (a) => a.class === cls && a.section === section
    );
    if (!assignments.length) {
      return res.status(400).json({
        success: false,
        message: `No subject-teacher assignments found for ${cls}-${section}. Assign teaching subjects first.`,
      });
    }

    const plan = []; // { day, periods, skipped }
    const skipped = [];
    const plannedByDay = new Map();

    for (const day of requestedDays) {
      const existing = await Timetable.findOne({
        schoolId: req.tenantId,
        class: cls,
        section,
        day,
      }).lean();
      if (existing && !overwrite) {
        skipped.push(day);
        continue;
      }

      const others = await Timetable.find({
        schoolId: req.tenantId,
        day,
        _id: existing ? { $ne: existing._id } : { $ne: null },
      }).lean();
      const otherDocs = others.map((d) => ({
        label: `${d.class}-${d.section}`,
        periods: d.periods,
      }));

      const generated = [];
      let cursor = 0;
      for (const slot of slots) {
        let placed = null;
        for (let t = 0; t < assignments.length; t += 1) {
          const cand = assignments[(cursor + t) % assignments.length];
          const candidate = {
            subject: cand.subject,
            teacherId: cand.teacherId,
            teacherName: cand.teacherName,
            roomId: "",
            roomName: "",
            startTime: slot.startTime,
            endTime: slot.endTime,
          };
          if (findCrossDocConflicts([candidate], otherDocs, day).length === 0) {
            placed = candidate;
            cursor = (cursor + t + 1) % assignments.length;
            break;
          }
        }
        if (!placed) {
          // Every candidate teacher is busy on this interval: keep the subject
          // in the plan with no teacher (manual assignment later).
          const head = assignments[cursor % assignments.length];
          placed = {
            subject: head.subject,
            teacherId: "",
            teacherName: "",
            roomId: "",
            roomName: "",
            startTime: slot.startTime,
            endTime: slot.endTime,
          };
          cursor = (cursor + 1) % assignments.length;
        }
        generated.push(placed);
      }

      plan.push({ day, periods: generated, replaced: Boolean(existing) });
      plannedByDay.set(day, { existing, periods: generated });
    }

    if (dryRun) {
      return res.json({ success: true, dryRun: true, data: { days: plan, skipped } });
    }

    // Safety net: re-run the full conflict check (cross-class) for every
    // planned day before writing anything; one clash aborts the whole run.
    const conflicts = [];
    for (const { day, periods } of plan) {
      const { existing } = plannedByDay.get(day);
      const found = await findCrossClassConflicts({
        schoolId: req.tenantId,
        day,
        periods,
        currentId: existing ? existing._id : null,
      });
      conflicts.push(...found);
    }
    if (conflicts.length) {
      return res
        .status(409)
        .json({ success: false, message: "Scheduling conflict detected", conflicts: [...new Set(conflicts)] });
    }

    const created = [];
    const updated = [];
    for (const { day, periods } of plan) {
      const { existing } = plannedByDay.get(day);
      await Timetable.findOneAndUpdate(
        { schoolId: req.tenantId, class: cls, section, day },
        { class: cls, section, day, periods, schoolId: req.tenantId },
        { new: true, upsert: true, runValidators: true }
      );
      (existing ? updated : created).push(day);
    }

    res.status(201).json({
      success: true,
      data: { created, updated, skipped, days: plan },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "A timetable for this class, section and day already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { generateTimetable };

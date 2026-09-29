const Substitution = require("../models/Substitution");
const Timetable = require("../models/Timetable");
const { findCrossClassConflicts } = require("../utils/periodConflicts");
const { intervalsOverlap, TIME_RE } = require("../utils/periodConflictLib");
const { notifyByRefIds, notifyClassStudents } = require("../utils/notify");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// Validates YYYY-MM-DD (rejects rollover dates like 2026-02-30) and maps it
// to a weekday name. Returns { ok, day }.
function resolveDay(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { ok: false, message: "date must be YYYY-MM-DD" };
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return { ok: false, message: "date is not a valid calendar date" };
  }
  return { ok: true, day: DAY_NAMES[date.getDay()] };
}

// POST /api/timetable/substitutions
// Creates coverage for ONE existing timetable period. The period must exist
// and already carry an original teacher; the substitute must be free for that
// interval (timetable + other substitutions) or the request is a 409.
const createSubstitution = async (req, res) => {
  try {
    const {
      date = "",
      class: cls = "",
      section = "",
      startTime = "",
      endTime = "",
      substituteTeacherId = "",
      substituteTeacherName = "",
      reason = "",
    } = req.body || {};

    if (!cls || !section) {
      return res.status(400).json({ success: false, message: "class and section are required" });
    }
    const resolved = resolveDay(date);
    if (!resolved.ok) {
      return res.status(400).json({ success: false, message: resolved.message });
    }
    if (!DAYS.includes(resolved.day)) {
      return res.status(400).json({
        success: false,
        message: `No timetable on ${resolved.day}; substitutions only apply on ${DAYS.join(", ")}`,
      });
    }
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime) || endTime <= startTime) {
      return res.status(400).json({
        success: false,
        message: "startTime/endTime must be valid HH:MM with endTime after startTime",
      });
    }
    if (!substituteTeacherId) {
      return res.status(400).json({ success: false, message: "substituteTeacherId is required" });
    }

    // The period must exist in the published timetable so the substitution can
    // never drift from the schedule (subject/room/teacher are derived from it).
    const timetable = await Timetable.findOne({
      schoolId: req.tenantId,
      class: cls,
      section,
      day: resolved.day,
    }).lean();
    if (!timetable) {
      return res
        .status(400)
        .json({ success: false, message: `No timetable for ${cls}-${section} on ${resolved.day}` });
    }
    const period = (timetable.periods || []).find(
      (p) => p.startTime === startTime && p.endTime === endTime
    );
    if (!period) {
      return res.status(400).json({
        success: false,
        message: `No period ${startTime}-${endTime} in the ${cls}-${section} ${resolved.day} timetable`,
      });
    }
    if (!period.teacherId) {
      return res
        .status(400)
        .json({ success: false, message: "That period has no teacher to substitute" });
    }
    if (String(substituteTeacherId) === String(period.teacherId)) {
      return res.status(400).json({
        success: false,
        message: "substituteTeacherId must differ from the original teacher",
      });
    }

    // Substitute-teacher availability for that interval:
    //  (a) against every committed timetable period of the school that day
    //      (roomId omitted on purpose — the room stays reserved by the very
    //      period being substituted, so it is never a double-booking).
    //  (b) against other active substitutions on the same date.
    const timetableClashes = await findCrossClassConflicts({
      schoolId: req.tenantId,
      day: resolved.day,
      periods: [
        {
          teacherId: String(substituteTeacherId),
          teacherName: String(substituteTeacherName || ""),
          subject: period.subject || "",
          startTime,
          endTime,
        },
      ],
      currentId: null,
    });
    if (timetableClashes.length) {
      return res
        .status(409)
        .json({ success: false, message: "Scheduling conflict detected", conflicts: timetableClashes });
    }

    const otherSubs = await Substitution.find({
      schoolId: req.tenantId,
      date,
      status: "scheduled",
      substituteTeacherId: String(substituteTeacherId),
    }).lean();
    const subClashes = otherSubs
      .filter((o) => intervalsOverlap(o.startTime, o.endTime, startTime, endTime))
      .map(
        (o) =>
          `${o.substituteTeacherName || o.substituteTeacherId} is already substituting ` +
          `on ${date} at ${o.startTime}-${o.endTime} (Class ${o.class}-${o.section})`
      );
    if (subClashes.length) {
      return res
        .status(409)
        .json({ success: false, message: "Scheduling conflict detected", conflicts: subClashes });
    }

    let created;
    try {
      created = await Substitution.create({
        schoolId: req.tenantId,
        date,
        day: resolved.day,
        class: cls,
        section,
        startTime,
        endTime,
        subject: period.subject || "",
        originalTeacherId: String(period.teacherId),
        originalTeacherName: String(period.teacherName || ""),
        substituteTeacherId: String(substituteTeacherId),
        substituteTeacherName: String(substituteTeacherName || ""),
        roomId: period.roomId || "",
        roomName: period.roomName || "",
        reason: String(reason || "").slice(0, 500),
        status: "scheduled",
        createdBy: req.user.refId ? String(req.user.refId) : "",
      });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "A substitution already exists for this class period",
        });
      }
      throw err;
    }

    // Coverage notifications (non-fatal: notify helper swallows failures).
    notifyByRefIds({
      schoolId: req.tenantId,
      refIds: [String(substituteTeacherId)],
      title: "Substitution assigned",
      message:
        `You will substitute ${period.teacherName || "a colleague"} for ${period.subject} ` +
        `— Class ${cls}-${section}, ${resolved.day} ${date}, ${startTime}-${endTime}.` +
        (reason ? ` Reason: ${reason}` : ""),
      kind: "system",
      link: "/teacher/timetable",
    });
    notifyClassStudents({
      schoolId: req.tenantId,
      class: cls,
      section,
      title: "Teacher substitution",
      message:
        `${substituteTeacherName || "A teacher"} will take your ${period.subject} period ` +
        `on ${date} (${startTime}-${endTime}) in place of ${period.teacherName || "your teacher"}.`,
      kind: "system",
      link: "/timetable",
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/timetable/substitutions
// Admin sees everything; teachers see only substitutions they are part of;
// students only their own class; parents have no substitution view.
const listSubstitutions = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    if (req.query.date) {
      filter.date = String(req.query.date);
    } else {
      if (req.query.from) filter.date = { ...(filter.date || {}), $gte: String(req.query.from) };
      if (req.query.to) filter.date = { ...(filter.date || {}), $lte: String(req.query.to) };
      if (!filter.date) delete filter.date;
    }
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.class) filter.class = String(req.query.class);
    if (req.query.section) filter.section = String(req.query.section);

    const role = req.user.role;
    if (role === "teacher") {
      const me = String(req.user.refId || "");
      filter.$or = [{ originalTeacherId: me }, { substituteTeacherId: me }];
    } else if (role === "student") {
      if (!req.user.class) return res.json({ success: true, count: 0, data: [] });
      filter.class = String(req.user.class);
      if (req.user.section) filter.section = String(req.user.section);
    } else if (role === "parent") {
      return res.json({ success: true, count: 0, data: [] });
    }

    const data = await Substitution.find(filter).sort({ date: -1, startTime: 1 }).lean();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/timetable/substitutions/:id/status
const setStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["completed", "cancelled"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "status must be 'completed' or 'cancelled'" });
    }
    const doc = await Substitution.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!doc) {
      return res.status(404).json({ success: false, message: "Substitution not found" });
    }
    if (req.teacherScope && !req.teacherScope.has(doc.class, doc.section)) {
      return res.status(403).json({
        success: false,
        message: "Teachers can only manage their assigned classes and sections",
      });
    }
    doc.status = status;
    await doc.save();

    if (status === "cancelled") {
      notifyByRefIds({
        schoolId: req.tenantId,
        refIds: [String(doc.substituteTeacherId)],
        title: "Substitution cancelled",
        message:
          `Your substitution for Class ${doc.class}-${doc.section} on ${doc.date} ` +
          `(${doc.startTime}-${doc.endTime}) has been cancelled.`,
        kind: "system",
        link: "/teacher/timetable",
      });
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/timetable/substitutions/:id
const deleteSubstitution = async (req, res) => {
  try {
    const doc = await Substitution.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!doc) {
      return res.status(404).json({ success: false, message: "Substitution not found" });
    }
    if (req.teacherScope && !req.teacherScope.has(doc.class, doc.section)) {
      return res.status(403).json({
        success: false,
        message: "Teachers can only manage their assigned classes and sections",
      });
    }
    await doc.deleteOne();
    res.json({ success: true, message: "Substitution removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createSubstitution, listSubstitutions, setStatus, deleteSubstitution };

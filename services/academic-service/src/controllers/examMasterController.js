const ExamType = require("../models/ExamType");
const FeeType = require("../models/FeeType");
const BookCategory = require("../models/BookCategory");
const SchoolClass = require("../models/SchoolClass");
const SchoolSection = require("../models/SchoolSection");
const SchoolSubject = require("../models/SchoolSubject");
const TimeSlot = require("../models/TimeSlot");
const Room = require("../models/Room");
const AttendanceStatus = require("../models/AttendanceStatus");
const LeaveType = require("../models/LeaveType");
const NoticeCategory = require("../models/NoticeCategory");
const NoticeAudience = require("../models/NoticeAudience");
const EventCategory = require("../models/EventCategory");
const HostelBlock = require("../models/HostelBlock");
const {
  createMasterController,
  httpError,
  clean,
  normalizeKey,
} = require("@school-erp/shared/src/master-data");
const { findMissingMasterRefs, missingMessage } = require("../utils/masterRefs");
const { writeMasterAudit } = require("../utils/audit");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------- formatters
function format12h(time) {
  const [hh, mm] = time.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour}:${String(mm).padStart(2, "0")} ${suffix}`;
}

function timeSlotLabel(startTime, endTime) {
  return `${format12h(startTime)} – ${format12h(endTime)}`;
}

// ------------------------------------------------------- per-school defaults
const CLASS_SEEDS = [
  "Nursery", "LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11-Sci", "11-Com", "12-Sci", "12-Com",
];
const SECTION_SEEDS = ["A", "B", "C"];
const SUBJECT_SEEDS = [
  "Mathematics", "English", "Science", "Hindi", "Social Science",
  "Computer Science", "Physics", "Chemistry", "Biology", "Accountancy",
  "Business Studies", "Economics", "Physical Education",
];

// Platform-level (global) subject library removed: all business master data is
// school-owned, so subjects are tenant rows like every other kind.

const FEE_TYPE_SEEDS = [
  "Tuition", "Transport", "Hostel", "Exam", "Library", "Sports", "Lab", "Miscellaneous",
];
const BOOK_CATEGORY_SEEDS = [
  "Textbook", "Fiction", "Finance", "Biography", "History", "Self-Help", "Science", "Reference",
];
const EXAM_TYPE_SEEDS = [
  "Term 1 — Unit Test", "Term 1 — Mid Term", "Term 1 — Final",
  "Term 2 — Unit Test", "Term 2 — Mid Term", "Term 2 — Final",
  "Pre-Board", "Practical",
];
const ROOM_SEEDS = [
  "Room 101", "Room 102", "Room 201", "Room 202", "Room 203", "Room 204",
  "Room 301", "Room 302", "Lab 1", "Lab 2", "Auditorium", "Hall A",
];
const TIME_SLOT_SEEDS = [
  ["09:00", "11:00"], ["09:00", "12:00"], ["10:00", "12:00"],
  ["11:00", "13:00"], ["13:00", "15:00"], ["14:00", "16:00"],
];
const ATTENDANCE_STATUS_SEEDS = ["Present", "Absent", "Late", "Leave"];
const LEAVE_TYPE_SEEDS = [
  "Casual Leave",
  "Sick Leave",
  "Privilege Leave",
  "Medical Leave",
  "Maternity Leave",
  "Emergency Leave",
];
const NOTICE_CATEGORY_SEEDS = [
  "Academic", "Holiday", "Sports", "Fees", "Event", "Transport", "General",
];
const NOTICE_AUDIENCE_SEEDS = [
  "All", "All Parents", "All Staff", "Classes 1–5 Parents",
  "Classes 6–8 Parents", "Classes 9–12 Parents", "Classes 3–10",
  "Transport Users",
];
const EVENT_CATEGORY_SEEDS = [
  "Sports", "National", "Academic", "Cultural", "Holiday", "Meeting", "Other",
];
const HOSTEL_BLOCK_SEEDS = ["A", "B", "C", "D"];

const SUBJECT_KIND = {
  label: "Subject",
  model: SchoolSubject,
  sort: { name: 1 },
  build(payload) {
    const name = clean(payload.name);
    if (!name) throw httpError(400, "Subject name is required");
    const out = { name, className: clean(payload.className) };
    if (payload.description != null) out.description = clean(payload.description);
    return out;
  },
  // Subject names are unique per school on the logical (normalized) name.
  // className is intentionally excluded so a school cannot hold two
  // "Mathematics" rows under one scope.
  dupFilter(payload) {
    const name = payload.normalizedName || normalizeKey(payload.name);
    return name ? { normalizedName: name } : null;
  },
  lifecycle: { field: "status", active: "active", inactive: "inactive" },
  // scope is retained on the model for DB compatibility with pre-migration
  // rows; every new subject is written as a plain tenant row (scope "tenant").
  defaults: (req) => ({ scope: "tenant" }),
  seeds: () => SUBJECT_SEEDS.map((name) => ({ name, className: "" })),
};

const MASTERS = {
  "exam-types": {
    label: "Exam type",
    model: ExamType,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Exam type name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => EXAM_TYPE_SEEDS.map((name) => ({ name })),
  },
  classes: {
    label: "Class",
    model: SchoolClass,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Class name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => CLASS_SEEDS.map((name) => ({ name })),
  },
  sections: {
    label: "Section",
    model: SchoolSection,
    sort: { className: 1, name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Section name is required");
      return { name, className: clean(payload.className) };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { className: clean(payload.className), key: name } : null;
    },
    seeds: () =>
      CLASS_SEEDS.flatMap((className) =>
        SECTION_SEEDS.map((name) => ({ className, name })),
      ),
  },
  subjects: SUBJECT_KIND,
  "time-slots": {
    label: "Time slot",
    model: TimeSlot,
    sort: { startTime: 1, endTime: 1 },
    build(payload) {
      const startTime = clean(payload.startTime);
      const endTime = clean(payload.endTime);
      if (!startTime || !endTime) {
        throw httpError(400, "Start time and end time are required (HH:MM)");
      }
      if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
        throw httpError(400, "Times must use HH:MM format (24h)");
      }
      if (startTime >= endTime) {
        throw httpError(400, "End time must be after start time");
      }
      return { startTime, endTime, label: timeSlotLabel(startTime, endTime) };
    },
    dupFilter(payload) {
      const startTime = clean(payload.startTime);
      const endTime = clean(payload.endTime);
      return startTime && endTime ? { startTime, endTime } : null;
    },
    seeds: () =>
      TIME_SLOT_SEEDS.map(([startTime, endTime]) => ({
        startTime,
        endTime,
        label: timeSlotLabel(startTime, endTime),
      })),
  },
  "fee-types": {
    label: "Fee type",
    model: FeeType,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Fee type name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => FEE_TYPE_SEEDS.map((name) => ({ name })),
  },
  "book-categories": {
    label: "Book category",
    model: BookCategory,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Book category name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => BOOK_CATEGORY_SEEDS.map((name) => ({ name })),
  },
  rooms: {
    label: "Room",
    model: Room,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Room name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => ROOM_SEEDS.map((name) => ({ name })),
  },
  "attendance-statuses": {
    label: "Attendance status",
    model: AttendanceStatus,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Attendance status name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => ATTENDANCE_STATUS_SEEDS.map((name) => ({ name })),
  },
  "leave-types": {
    label: "Leave type",
    model: LeaveType,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Leave type name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => LEAVE_TYPE_SEEDS.map((name) => ({ name })),
  },
  "notice-categories": {
    label: "Notice category",
    model: NoticeCategory,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Notice category name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => NOTICE_CATEGORY_SEEDS.map((name) => ({ name })),
  },
  "notice-audiences": {
    label: "Notice audience",
    model: NoticeAudience,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Notice audience name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => NOTICE_AUDIENCE_SEEDS.map((name) => ({ name })),
  },
  "event-categories": {
    label: "Event category",
    model: EventCategory,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Event category name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => EVENT_CATEGORY_SEEDS.map((name) => ({ name })),
  },
  "hostel-blocks": {
    label: "Hostel block",
    model: HostelBlock,
    sort: { name: 1 },
    build(payload) {
      const name = clean(payload.name);
      if (!name) throw httpError(400, "Hostel block name is required");
      return { name };
    },
    dupFilter(payload) {
      const name = normalizeKey(payload.name);
      return name ? { key: name } : null;
    },
    seeds: () => HOSTEL_BLOCK_SEEDS.map((name) => ({ name })),
  },
};

const controller = createMasterController({
  kinds: MASTERS,
  readPermission: "exams:read",
  writePermission: "exams:write",
  audit: async ({ req, action, target }) => {
    const name = target && (target.name || target.label);
    await writeMasterAudit({
      req,
      action: `master.${action}`,
      targetId: target && target._id ? String(target._id) : null,
      message: `${req.params.kind || "master"} "${name || ""}" ${action}`.replace(/\s+/g, " "),
    });
  },
});

// Cross-service referential integrity endpoint. Student/staff/fee forward the
// caller's Bearer token + X-School-Id, so this re-uses the same identity and
// tenant. Returns 400 with the offending values when a provided value does not
// resolve to an active master (see utils/masterRefs.js for the empty-catalog
// compatibility leniency).
const validateRefs = async (req, res) => {
  try {
    const missing = await findMissingMasterRefs({
      schoolId: req.tenantId,
      class: req.body.class,
      section: req.body.section,
      subject: req.body.subject,
      room: req.body.room,
      feeType: req.body.feeType,
    });
    if (missing.length) {
      return res.status(400).json({ success: false, message: missingMessage(missing), missing });
    }
    res.json({ success: true, missing: [] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  list: controller.list,
  getById: controller.getById,
  create: controller.create,
  update: controller.update,
  deactivate: controller.deactivate,
  restore: controller.restore,
  validateRefs,
  MASTERS,
  timeSlotLabel,
};
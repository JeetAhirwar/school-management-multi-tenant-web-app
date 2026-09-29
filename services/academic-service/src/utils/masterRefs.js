const SchoolClass = require("../models/SchoolClass");
const SchoolSection = require("../models/SchoolSection");
const SchoolSubject = require("../models/SchoolSubject");
const Room = require("../models/Room");
const FeeType = require("../models/FeeType");
const { normalizeKey } = require("@school-erp/shared/src/master-data");

// Returns the academic master values that do NOT resolve to an active master
// inside this tenant: [{ kind, value }].
//
// LENIENCY: if a kind's tenant catalog is empty (masters not yet configured for
// this school) the check is skipped for that kind. This keeps the legacy
// free-string flow working until a school adopts the master catalogs - the
// "safe compatibility" path for existing 2026-27 data.
async function findMissingMasterRefs({ schoolId, class: cls, section, subject, room, feeType }) {
  const missing = [];

  const check = async (kind, value, Model, countFilter, matchFilter) => {
    const label = String(value == null ? "" : value).trim();
    if (!label) return;
    const activeCount = await Model.countDocuments(countFilter);
    if (activeCount === 0) return;
    const found = await Model.findOne(matchFilter).lean();
    if (!found) missing.push({ kind, value: label });
  };

  await check("class", cls, SchoolClass, { schoolId, active: true }, {
    schoolId,
    active: true,
    $or: [{ key: normalizeKey(cls) }, { name: String(cls).trim() }],
  });
  await check("section", section, SchoolSection, { schoolId, active: true }, {
    schoolId,
    active: true,
    $or: [{ key: normalizeKey(section) }, { name: String(section).trim() }],
  });
  // Subjects are school-owned masters just like the other kinds; we no longer
  // resolve a legacy platform "global" library, so checks are strictly scoped
  // to this tenant's active rows.
  await check("subject", subject, SchoolSubject,
    { schoolId, status: "active" },
    {
      schoolId,
      status: "active",
      $or: [{ normalizedName: normalizeKey(subject) }, { name: String(subject).trim() }],
    },
  );
  await check("room", room, Room, { schoolId, active: true }, {
    schoolId,
    active: true,
    $or: [{ key: normalizeKey(room) }, { name: String(room).trim() }],
  });
  await check("feeType", feeType, FeeType, { schoolId, active: true }, {
    schoolId,
    active: true,
    $or: [{ key: normalizeKey(feeType) }, { name: String(feeType).trim() }],
  });

  return missing;
}

// Non-academic timetable period labels that are intentionally not part of the
// subject master catalog (they describe time usage, not a taught subject).
const NON_ACADEMIC_PERIODS = new Set(
  ["Break", "Lunch", "Library", "Assembly", "Sports", "Games", "Free", "Recess"]
    .map((label) => label.toLowerCase().trim()),
);

// Validates a LIST of subject strings (timetable periods) with one catalog
// presence check instead of one per subject.
async function findMissingSubjects({ schoolId, subjects }) {
  const values = [
    ...new Set(
      (subjects || [])
        .map((s) => String(s).trim())
        .filter((s) => s && !NON_ACADEMIC_PERIODS.has(s.toLowerCase())),
    ),
  ];
  if (!values.length) return [];
  const activeCount = await SchoolSubject.countDocuments({ schoolId, status: "active" });
  if (activeCount === 0) return [];
  const missing = [];
  for (const value of values) {
    const found = await SchoolSubject.findOne({
      schoolId,
      status: "active",
      $or: [{ normalizedName: normalizeKey(value) }, { name: value }],
    }).lean();
    if (!found) missing.push({ kind: "subject", value });
  }
  return missing;
}

function missingMessage(missing) {
  return `Unknown academic value: ${missing
    .map((m) => `${m.kind} "${m.value}"`)
    .join(", ")}`;
}

// Validates a LIST of room references (timetable periods) against the tenant's
// active Room catalog — same leniency as the other checks (skipped while the
// catalog is empty so legacy free-string data keeps working).
async function findMissingRooms({ schoolId, rooms }) {
  const values = [...new Set((rooms || []).map((r) => String(r).trim()).filter(Boolean))];
  if (!values.length) return [];
  const activeCount = await Room.countDocuments({ schoolId, active: true });
  if (activeCount === 0) return [];
  const missing = [];
  for (const value of values) {
    const found = await Room.findOne({
      schoolId,
      active: true,
      $or: [{ key: normalizeKey(value) }, { name: value }],
    }).lean();
    if (!found) missing.push({ kind: "room", value });
  }
  return missing;
}

module.exports = { findMissingMasterRefs, findMissingSubjects, findMissingRooms, missingMessage };
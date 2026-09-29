// Async cross-class conflict lookup: loads the committed timetable docs for the
// same school+day whose periods involve any of the candidate teachers or rooms,
// then delegates the interval-overlap comparison to the pure library.

const Timetable = require("../models/Timetable");
const { findCrossDocConflicts } = require("./periodConflictLib");

async function findCrossClassConflicts({ schoolId, day, periods, currentId }) {
  const committed = (periods || []).filter((p) => p.startTime && (p.teacherId || p.roomId));
  if (!committed.length) return [];

  const teacherIds = [...new Set(committed.map((p) => p.teacherId).filter(Boolean))];
  const roomIds = [...new Set(committed.map((p) => p.roomId).filter(Boolean))];

  const query = {
    schoolId,
    day,
    _id: currentId ? { $ne: currentId } : { $ne: null },
    $or: [
      ...(teacherIds.length
        ? [{ periods: { $elemMatch: { teacherId: { $in: teacherIds } } } }]
        : []),
      ...(roomIds.length ? [{ periods: { $elemMatch: { roomId: { $in: roomIds } } } }] : []),
    ],
  };

  const docs = await Timetable.find(query).lean();
  const conflicts = findCrossDocConflicts(
    committed,
    docs.map((d) => ({ label: `${d.class}-${d.section}`, periods: d.periods })),
    day
  );
  return [...new Set(conflicts)];
}

module.exports = { findCrossClassConflicts };

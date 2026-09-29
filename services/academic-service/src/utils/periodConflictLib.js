// Pure interval-overlap logic for timetable conflict detection.
// Kept dependency-free (no mongoose) so it can be unit-tested directly.
//
// Times are zero-padded HH:MM strings (validated by TIME_RE), so they are
// lexicographically ordered and directly comparable.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTime(t) {
  return typeof t === "string" && TIME_RE.test(t);
}

// Two periods overlap when each starts before the other ends. Adjacent periods
// (09:00-10:00 and 10:00-11:00) are NOT an overlap; partial overlaps
// (09:00-10:00 and 09:30-10:30) and containment (08:00-10:00 vs 09:00-09:30) are.
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  if (!isValidTime(aStart) || !isValidTime(aEnd) || !isValidTime(bStart) || !isValidTime(bEnd)) {
    return false;
  }
  return aStart < bEnd && bStart < aEnd;
}

function periodsOverlap(a, b) {
  return intervalsOverlap(
    a && a.startTime, a && a.endTime,
    b && b.startTime, b && b.endTime
  );
}

// Any two periods of the same class-day that overlap in time.
function findIntraDayOverlaps(periods) {
  const conflicts = [];
  const list = Array.isArray(periods) ? periods : [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (periodsOverlap(list[i], list[j])) {
        conflicts.push(
          `Period "${list[i].subject}" (${list[i].startTime}-${list[i].endTime}) overlaps ` +
            `"${list[j].subject}" (${list[j].startTime}-${list[j].endTime}) in the same day`
        );
      }
    }
  }
  return conflicts;
}

// Candidate day periods vs committed periods of OTHER class-section docs.
// `others` is [{ label: "Class-Section", periods: [...] }].
// Flags a clash when the intervals overlap AND the same teacher or the same
// room is booked in both.
function findCrossDocConflicts(candidatePeriods, others, day) {
  const conflicts = [];
  for (const other of others || []) {
    for (const a of candidatePeriods || []) {
      for (const b of (other && other.periods) || []) {
        if (!periodsOverlap(a, b)) continue;
        if (a.teacherId && b.teacherId && a.teacherId === b.teacherId) {
          conflicts.push(
            `${b.teacherName || b.teacherId} is already teaching ${b.subject} ` +
              `at ${b.startTime}-${b.endTime} on ${day} (${other.label})`
          );
        }
        if (a.roomId && b.roomId && a.roomId === b.roomId) {
          conflicts.push(
            `Room "${b.roomName || b.roomId}" is already occupied by ${b.subject} ` +
              `at ${b.startTime}-${b.endTime} on ${day} (${other.label})`
          );
        }
      }
    }
  }
  return conflicts;
}

module.exports = {
  TIME_RE,
  isValidTime,
  intervalsOverlap,
  periodsOverlap,
  findIntraDayOverlaps,
  findCrossDocConflicts,
};

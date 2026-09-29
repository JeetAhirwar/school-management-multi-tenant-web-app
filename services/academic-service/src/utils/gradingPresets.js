// Built-in grading presets. Every tenant gets these seeded rows (list
// endpoint seeds on first access); schools may activate any preset, edit its
// bands, or define fully custom scales.
//
// Band semantics: bands are checked top-down against the obtained PERCENTAGE;
// the first band with pct >= minPct wins. The lowest band must have
// minPct === 0 (enforced by validateScaleBands) so every score grades.

const GRADING_PRESETS = [
  {
    key: "default",
    name: "Default (A+ to F)",
    system: "default",
    passPct: 33,
    bands: [
      { grade: "A+", minPct: 90 },
      { grade: "A", minPct: 80 },
      { grade: "B+", minPct: 70 },
      { grade: "B", minPct: 60 },
      { grade: "C", minPct: 50 },
      { grade: "D", minPct: 33 },
      { grade: "F", minPct: 0 },
    ],
  },
  {
    key: "cbse",
    name: "CBSE (A1 to E)",
    system: "cbse",
    passPct: 33,
    // CBSE publication bands: 91-100 A1, 81-90 A2, 71-80 B1, 61-70 B2,
    // 51-60 C1, 41-50 C2, 33-40 D, below 33 E (fail).
    bands: [
      { grade: "A1", minPct: 91 },
      { grade: "A2", minPct: 81 },
      { grade: "B1", minPct: 71 },
      { grade: "B2", minPct: 61 },
      { grade: "C1", minPct: 51 },
      { grade: "C2", minPct: 41 },
      { grade: "D", minPct: 33 },
      { grade: "E", minPct: 0 },
    ],
  },
  {
    key: "icse",
    name: "ICSE / CISCE",
    system: "icse",
    // CISCE passes on aggregate percentage (35); bands below are the
    // commonly used percentage descriptors and stay fully editable per school.
    passPct: 35,
    bands: [
      { grade: "A+", minPct: 90 },
      { grade: "A", minPct: 80 },
      { grade: "B+", minPct: 70 },
      { grade: "B", minPct: 60 },
      { grade: "C", minPct: 50 },
      { grade: "D", minPct: 40 },
      { grade: "E", minPct: 35 },
      { grade: "F", minPct: 0 },
    ],
  },
];

module.exports = { GRADING_PRESETS, validateScaleBands };

// Structural validation for a band list (used by the GradingScale model hook
// and the create/update endpoints). Returns an error message or null.
// Pure + dependency-free so it is directly unit-testable.
function validateScaleBands(bands) {
  if (!Array.isArray(bands) || bands.length === 0) {
    return "bands must be a non-empty array";
  }
  const seen = new Set();
  for (let i = 0; i < bands.length; i += 1) {
    const b = bands[i] || {};
    const grade = String(b.grade == null ? "" : b.grade).trim();
    const minPct = b.minPct;
    if (!grade) return `band ${i + 1}: grade is required`;
    if (grade.length > 12) return `band ${i + 1}: grade must be at most 12 characters`;
    if (typeof minPct !== "number" || Number.isNaN(minPct) || minPct < 0 || minPct > 100) {
      return `band ${i + 1}: minPct must be a number between 0 and 100`;
    }
    const dupKey = grade.toLowerCase();
    if (seen.has(dupKey)) return `duplicate grade "${grade}"`;
    seen.add(dupKey);
    if (i > 0) {
      const prev = bands[i - 1] || {};
      if (typeof prev.minPct !== "number" || minPct >= prev.minPct) {
        return "bands must be sorted by minPct in strictly descending order";
      }
    }
  }
  const lowest = bands[bands.length - 1];
  if (Number(lowest.minPct) !== 0) {
    return 'the lowest band must have minPct 0 so every score receives a grade';
  }
  return null;
}

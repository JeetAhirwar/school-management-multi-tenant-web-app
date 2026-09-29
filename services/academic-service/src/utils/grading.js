// ---------------------------------------------------------------------------
// Canonical grading utilities.
//
// Grades/pass thresholds are CONFIGURABLE per school via the GradingScale
// model (bands + passPct, one isDefault row per tenant). resolveScale(schoolId)
// returns the active scale, falling back to the built-in default preset when
// the school has none yet — so behaviour before any scale is configured is
// byte-identical to the legacy hardcoded scale (A+/A/B+/B/C/D/F, pass 33).
//
// Legacy sync helpers (computeGrade/computeResult) are kept as thin wrappers
// over the DEFAULT preset for call sites that cannot await; async call sites
// should use resolveScale + computeGradeWith/computeResultWith.
//
// The pass threshold is a PASS PERCENTAGE (default 33), which is how the
// legacy report card expressed "PASS iff pct >= 33". An exam's explicit
// passingMarks still wins over the scale when set.
// ---------------------------------------------------------------------------

const GradingScale = require("../models/GradingScale");
const { GRADING_PRESETS, validateScaleBands } = require("./gradingPresets");

const DEFAULT_PRESET = GRADING_PRESETS.find((p) => p.key === "default");

// The legacy hardcoded scale — kept exported for back-compat.
const GRADE_THRESHOLDS = DEFAULT_PRESET.bands;

const DEFAULT_SCALE = {
  name: DEFAULT_PRESET.name,
  system: "default",
  bands: DEFAULT_PRESET.bands,
  passPct: DEFAULT_PRESET.passPct,
};

function gradeFromBands(bands, obtained, max) {
  if (!max || max <= 0 || obtained == null) return "N/A";
  const pct = (obtained / max) * 100;
  const list = Array.isArray(bands) && bands.length ? bands : DEFAULT_SCALE.bands;
  const band = list.find((t) => pct >= t.minPct) || list[list.length - 1];
  return band.grade;
}

function computePercentage(obtained, max) {
  if (!max || max <= 0) return 0;
  return (obtained / max) * 100;
}

// Legacy sync helpers — always use the built-in default preset.
function computeGrade(obtained, max) {
  return gradeFromBands(DEFAULT_SCALE.bands, obtained, max);
}

function computeResult(obtained, max, passingMarks = 33) {
  const pct = computePercentage(obtained, max);
  return { pct, grade: computeGrade(obtained, max), passed: pct >= passingMarks };
}

// Scale-aware helpers.
function computeGradeWith(scale, obtained, max) {
  return gradeFromBands((scale && scale.bands) || DEFAULT_SCALE.bands, obtained, max);
}

// passOverride wins (exam-level explicit passingMarks); otherwise the scale's
// passPct applies; legacy default 33 last.
function computeResultWith(scale, obtained, max, passOverride = null) {
  const pct = computePercentage(obtained, max);
  const passPct =
    passOverride == null ? ((scale && scale.passPct) != null ? scale.passPct : 33) : passOverride;
  return { pct, grade: computeGradeWith(scale, obtained, max), passed: pct >= passPct };
}

// Resolves the tenant's ACTIVE (isDefault) scale. Never throws: any failure
// degrades to the built-in default so grade computation can't break writes.
async function resolveScale(schoolId) {
  try {
    if (!schoolId) return DEFAULT_SCALE;
    const row = await GradingScale.findOne({ schoolId, isDefault: true, active: true }).lean();
    if (row && Array.isArray(row.bands) && row.bands.length) return row;
    return DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}

// Promotion health-check. A student with no published marks for the session
// has no evidence to be detained, so the suggestion stays "Promoted".
function suggestPromotionStatus({ subjects, totalSubjects = 0, failedSubjects = 0 } = {}) {
  const total = Array.isArray(subjects) ? subjects.length : totalSubjects;
  if (total === 0) return "Promoted";
  if (failedSubjects >= 3) return "Detained";
  if (failedSubjects >= 1) return "Promoted with Conditions";
  return "Promoted";
}

module.exports = {
  GRADE_THRESHOLDS,
  DEFAULT_SCALE,
  computeGrade,
  computePercentage,
  computeResult,
  computeGradeWith,
  computeResultWith,
  resolveScale,
  validateScaleBands,
  suggestPromotionStatus,
};

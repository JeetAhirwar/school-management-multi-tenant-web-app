const Concession = require("../models/Concession");

// Which concession wins when a student has several Active rows: scholarships
// beat sibling discounts beat manual grants; ties go to the larger benefit.
const KIND_PRIORITY = { Scholarship: 3, Sibling: 2, Manual: 1 };

// Apply at most one concession to a gross amount. Returns the fields stored
// on the invoice: grossAmount (pre-concession), concessionAmount (the
// discount), amount (net payable — what every downstream payment path uses).
const applyConcession = (gross, concession) => {
  const g = Number(gross) || 0;
  if (!concession || g <= 0) return { grossAmount: g, concessionAmount: 0, amount: g };
  const raw =
    concession.type === "percent"
      ? Math.round((g * Math.min(100, Number(concession.value) || 0)) / 100)
      : Number(concession.value) || 0;
  const concessionAmount = Math.max(0, Math.min(g, raw));
  return { grossAmount: g, concessionAmount, amount: Math.max(0, g - concessionAmount) };
};

// Batch-fetch the winning Active concession for each student for a given
// session + fee type (feeType ""/absent = all fee types). Returns a Map keyed
// by studentId. One query per generation run — no N+1.
const findApplicableConcessions = async (schoolId, studentIds, { session, feeType = "" }) => {
  const ids = [...new Set((studentIds || []).map((s) => String(s)).filter(Boolean))];
  if (!ids.length || !session) return new Map();
  const docs = await Concession.find({
    schoolId,
    studentId: { $in: ids },
    session,
    status: "Active",
    $or: [{ feeType: "" }, { feeType: null }, { feeType: { $exists: false } }, { feeType }],
  }).lean();

  const best = new Map();
  for (const doc of docs) {
    const current = best.get(String(doc.studentId));
    if (!current) {
      best.set(String(doc.studentId), doc);
      continue;
    }
    const docPriority = KIND_PRIORITY[doc.kind] || 0;
    const curPriority = KIND_PRIORITY[current.kind] || 0;
    if (docPriority > curPriority) {
      best.set(String(doc.studentId), doc);
    } else if (
      docPriority === curPriority &&
      doc.type === current.type &&
      (Number(doc.value) || 0) > (Number(current.value) || 0)
    ) {
      best.set(String(doc.studentId), doc);
    }
  }
  return best;
};

module.exports = { applyConcession, findApplicableConcessions };

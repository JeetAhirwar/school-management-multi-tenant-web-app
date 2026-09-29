const Concession = require("../models/Concession");

// Concession workflow (CLIENT-REQ-045/046/047): created as Requested,
// approved to Active (or rejected) by a fee-structure manager. Only Active
// rows are applied when invoices are generated.

const KINDS = ["Sibling", "Scholarship", "Manual"];

const validate = (body) => {
  const { studentId, kind, name, type, value, session } = body || {};
  if (!studentId || !String(studentId).trim()) return "studentId is required";
  if (!KINDS.includes(kind)) return `kind must be one of: ${KINDS.join(", ")}`;
  if (!name || !String(name).trim()) return "name is required";
  if (type !== "percent" && type !== "flat") return "type must be 'percent' or 'flat'";
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "value must be a non-negative number";
  if (type === "percent" && num > 100) return "percent value cannot exceed 100";
  if (type === "flat" && num === 0) return "flat value must be greater than 0";
  if (!session || !String(session).trim()) return "session is required";
  return null;
};

const getConcessions = async (req, res) => {
  try {
    const { studentId, status, kind, session } = req.query;
    const filter = { schoolId: req.tenantId };
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;
    if (kind) filter.kind = kind;
    if (session) filter.session = session;
    const data = await Concession.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createConcession = async (req, res) => {
  try {
    const error = validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const { studentId, kind, session } = req.body;
    // One live (Requested/Active) row per student+kind+session — a Rejected
    // row must not block a fresh request.
    const live = await Concession.findOne({
      schoolId: req.tenantId,
      studentId: String(studentId).trim(),
      kind,
      session: String(session).trim(),
      status: { $ne: "Rejected" },
    })
      .select("_id")
      .lean();
    if (live) {
      return res.status(409).json({
        success: false,
        message: `A ${kind} concession already exists for this student in ${session}`,
      });
    }

    const doc = await Concession.create({
      schoolId: req.tenantId,
      studentId: String(studentId).trim(),
      kind,
      name: String(req.body.name).trim(),
      type: req.body.type,
      value: Number(req.body.value),
      session: String(session).trim(),
      feeType: (req.body.feeType && String(req.body.feeType).trim()) || "",
      siblingOf: (req.body.siblingOf && String(req.body.siblingOf).trim()) || null,
      notes: (req.body.notes && String(req.body.notes).trim()) || "",
      requestedBy: req.user.name,
      status: "Requested",
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const decideConcession = (action) => async (req, res) => {
  try {
    const doc = await Concession.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!doc) return res.status(404).json({ success: false, message: "Concession not found" });
    if (doc.status !== "Requested") {
      return res.status(409).json({ success: false, message: `Concession already ${doc.status.toLowerCase()}` });
    }
    if (action === "approve") {
      doc.status = "Active";
      doc.approvedBy = req.user.name;
      doc.approvedAt = new Date();
    } else {
      doc.status = "Rejected";
      doc.rejectedBy = req.user.name;
      doc.rejectedReason = (req.body && req.body.reason && String(req.body.reason).trim()) || "";
    }
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Deleting a concession only affects FUTURE invoice generation — invoices
// already carry their own concession snapshot.
const removeConcession = async (req, res) => {
  try {
    const doc = await Concession.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!doc) return res.status(404).json({ success: false, message: "Concession not found" });
    res.json({ success: true, data: { deleted: 1 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getConcessions,
  createConcession,
  approveConcession: decideConcession("approve"),
  rejectConcession: decideConcession("reject"),
  removeConcession,
};

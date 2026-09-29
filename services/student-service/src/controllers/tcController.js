const { TransferCertificate, TcCounter } = require("../models/TransferCertificate");
const Student = require("../models/Student");
const { generateTcPdf } = require("../utils/tcPdf");

// Atomic per-school, per-year TC number: TC-2026-0001. A concurrent upsert
// race surfaces as E11000 on the counter's unique index → retry.
const allocateTcNumber = async (schoolId) => {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const counter = await TcCounter.findOneAndUpdate(
        { schoolId, year },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      );
      return `TC-${year}-${String(counter.seq).padStart(4, "0")}`;
    } catch (err) {
      if (err.code !== 11000 || attempt === 2) throw err;
    }
  }
  throw new Error("Could not allocate a TC number");
};

// Issue a Transfer Certificate. Deliberately does NOT change the student's
// status — the Transfers workflow (academic-service) remains the single
// source of truth for transfers (Phase 2 decision).
const issueTc = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || req.body?.admissionNo || "").trim();
    if (!studentId) {
      return res.status(400).json({ success: false, message: "studentId (Admission ID) is required" });
    }

    const student = await Student.findOne({
      schoolId: req.tenantId,
      admissionNo: studentId,
      deletedAt: null,
    }).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const existing = await TransferCertificate.findOne({
      schoolId: req.tenantId,
      studentId,
    }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A Transfer Certificate was already issued for this student (${existing.tcNumber}) — download it instead`,
        tcNumber: existing.tcNumber,
      });
    }

    const tcNumber = await allocateTcNumber(req.tenantId);
    const tc = await TransferCertificate.create({
      schoolId: req.tenantId,
      tcNumber,
      studentId,
      issueDate: req.body.issueDate ? new Date(req.body.issueDate) : new Date(),
      leavingDate: req.body.leavingDate ? new Date(req.body.leavingDate) : null,
      reason: String(req.body.reason || "").trim(),
      conduct: String(req.body.conduct || "").trim() || "Good",
      remarks: String(req.body.remarks || "").trim(),
      issuedBy: req.user.refId || req.user.id || "",
      issuedByName: req.user.name || "",
      snapshot: {
        name: student.name || "",
        admissionNo: student.admissionNo || "",
        class: student.class || "",
        section: student.section || "",
        gender: student.gender || "",
        dob: student.dob || null,
        parentName: student.parentName || "",
        motherName: student.motherName || "",
        admissionDate: student.admissionDate || null,
      },
    });

    res.status(201).json({ success: true, data: tc, message: `Transfer Certificate ${tcNumber} issued` });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate Transfer Certificate number — retry" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// List issued TCs for the school (optional ?studentId= admissionNo filter).
const getTcs = async (req, res) => {
  try {
    const { studentId } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const filter = { schoolId: req.tenantId };
    if (studentId) filter.studentId = String(studentId).trim();

    const [items, total] = await Promise.all([
      TransferCertificate.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TransferCertificate.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getTc = async (req, res) => {
  try {
    const tc = await TransferCertificate.findOne({ _id: req.params.id, schoolId: req.tenantId }).lean();
    if (!tc) return res.status(404).json({ success: false, message: "Transfer Certificate not found" });
    res.json({ success: true, data: tc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const downloadTcPdf = async (req, res) => {
  try {
    const tc = await TransferCertificate.findOne({ _id: req.params.id, schoolId: req.tenantId }).lean();
    if (!tc) return res.status(404).json({ success: false, message: "Transfer Certificate not found" });

    let school = {};
    try {
      const School = require("../models/School");
      const doc = await School.findById(req.tenantId)
        .select({ name: 1, code: 1, address: 1, city: 1, state: 1, phone: 1, email: 1 })
        .lean();
      if (doc) school = doc;
    } catch {
      // School lookup is header decoration only — never block the download.
    }

    const pdfBuffer = await generateTcPdf(tc, school);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="transfer-certificate-${tc.tcNumber}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { issueTc, getTcs, getTc, downloadTcPdf };

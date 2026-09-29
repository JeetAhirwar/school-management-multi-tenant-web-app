const FeeInvoice = require("../models/FeeInvoice");
const FeeStructure = require("../models/FeeStructure");
require("../models/School"); // registers mongoose.models.School for the PDF header
const { getStudentModel } = require("../db/studentDb");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { assertAcademicRefs } = require("@school-erp/shared/src/master-data");
const { generateFeeInvoicePdf } = require("../utils/feeInvoicePdf");
const { applyConcession, findApplicableConcessions } = require("../utils/concession");
const mongoose = require("mongoose");

// Mass-assignment guard: only these fields may be set from the request body.
// status / paidAmount / receiptNo are exclusively derived by the payments
// pipeline and must never be client-supplied.
const INVOICE_FIELDS = ["studentId", "class", "feeType", "session", "amount", "dueDate"];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const dupKey = (inv) => `${inv.feeType}||${inv.session}||${String(inv.studentId)}`;

const createInvoice = async (req, res) => {
  try {
    if (req.body.session !== undefined && String(req.body.session).trim() === "") {
      return res.status(400).json({ success: false, message: "session is required" });
    }
    if (req.body.amount !== undefined) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: "amount must be a positive number" });
      }
    }
    await assertAcademicRefs({ req, values: { class: req.body.class } });
    const base = pick(req.body, INVOICE_FIELDS);
    // Server-side netting: the client's amount is the GROSS charge; any Active
    // concession for this student/session/feeType is applied here so the
    // stored `amount` is always the net payable.
    const concessionMap = await findApplicableConcessions(req.tenantId, [base.studentId], {
      session: base.session || "",
      feeType: base.feeType || "",
    });
    const applied = applyConcession(base.amount, concessionMap.get(String(base.studentId)));
    const concession = concessionMap.get(String(base.studentId));
    const invoice = await FeeInvoice.create({
      ...base,
      ...(base.amount !== undefined
        ? {
            grossAmount: applied.grossAmount,
            concessionAmount: applied.concessionAmount,
            ...(concession ? { concessionId: concession._id } : {}),
            amount: applied.amount,
            ...(applied.amount === 0 ? { status: "Paid" } : {}),
          }
        : {}),
      schoolId: req.tenantId,
    });
    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
};

const getInvoices = async (req, res) => {
  try {
    const { studentId, status, session } = req.query;
    const filter = { schoolId: req.tenantId };
    // Parents are scoped to their linked children (CLIENT-REQ-052/066). The
    // JWT carries linkedStudentIds; students are scoped to their own refId.
    if (req.user.role === "parent") {
      const linked = (req.user.linkedStudentIds || []).map((s) => String(s)).filter(Boolean);
      if (studentId && !linked.includes(String(studentId))) {
        return res.status(403).json({ success: false, message: "You can only view your linked children's invoices" });
      }
      filter.studentId = { $in: linked };
    } else if (req.user.role === "student") {
      filter.studentId = String(req.user.refId || "");
    }
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;
    if (session) filter.session = session;
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      FeeInvoice.find(filter).sort({ dueDate: 1 }).skip(skip).limit(limit),
      FeeInvoice.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Dry-run bulk generation: match an active FeeStructure, resolve eligible
// students from the student mirror and flag any who already have an invoice for
// this feeType+session. No database writes.
const generatePreview = async (req, res) => {
  try {
    const { class: className, section, feeType, session, dueDate } = req.body || {};
    if (!className || !feeType || !session) {
      return res.status(400).json({ success: false, message: "class, feeType and session are required" });
    }
    await assertAcademicRefs({ req, values: { class: className, feeType } });

    const structure = await FeeStructure.findOne({
      schoolId: req.tenantId,
      class: className,
      feeType,
      session,
      active: true,
    });
    if (!structure) {
      return res.status(404).json({
        success: false,
        message: "No active fee structure found for the given class, feeType and session",
      });
    }

    // Preview amount comes from the active FeeStructure unless the request
    // explicitly overrides it.
    const amount = req.body.amount != null ? Number(req.body.amount) : Number(structure.amount);

    let Student;
    try {
      Student = await getStudentModel();
    } catch (err) {
      return res.status(503).json({ success: false, message: `Student enrollment lookup unavailable: ${err.message}` });
    }

    const query = { schoolId: req.tenantId, class: className, status: "Active" };
    if (section) query.section = section;

    const students = await Student.find(query).select("admissionNo name").lean();

    const admissions = students.map((s) => String(s.admissionNo));
    const existingDocs = admissions.length
      ? await FeeInvoice.find({
          schoolId: req.tenantId,
          feeType,
          session,
          studentId: { $in: admissions },
        })
          .select("studentId")
          .lean()
      : [];
    const existing = new Set(existingDocs.map((inv) => String(inv.studentId)));

    // Concession netting: preview shows the NET amount per student (with the
    // gross + discount alongside so the UI can explain the difference).
    const concessionMap = await findApplicableConcessions(req.tenantId, admissions, { session, feeType });

    const preview = students.map((s) => {
      const concession = concessionMap.get(String(s.admissionNo)) || null;
      const applied = applyConcession(amount, concession);
      return {
        studentId: String(s.admissionNo),
        studentName: s.name,
        amount: applied.amount,
        grossAmount: applied.grossAmount,
        concessionAmount: applied.concessionAmount,
        concession: concession
          ? { _id: concession._id, name: concession.name, kind: concession.kind, type: concession.type, value: concession.value }
          : null,
        isDuplicate: existing.has(String(s.admissionNo)),
      };
    });
    const duplicates = preview.filter((p) => p.isDuplicate);

    res.json({
      success: true,
      data: {
        class: className,
        ...(section ? { section } : {}),
        feeType,
        session,
        dueDate: dueDate || structure.dueDate || null,
        amount,
        totals: {
          count: preview.length,
          duplicates: duplicates.length,
          totalAmount: preview.reduce((sum, p) => (p.isDuplicate ? sum : sum + p.amount), 0),
        },
        preview,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
};

// Confirm bulk generation: create one FeeInvoice per preview row, skipping rows
// that already have an invoice for the same student+feeType+session within this
// tenant. schoolId is always forced from the tenant to preserve isolation.
const confirmGenerate = async (req, res) => {
  try {
    const { invoices } = req.body || {};
    if (!Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({ success: false, message: "invoices array is required" });
    }

    const REQUIRED = ["studentId", "feeType", "session", "amount", "dueDate"];
    const parsed = [];
    for (const inv of invoices) {
      for (const key of REQUIRED) {
        if (inv[key] == null || String(inv[key]).trim() === "") {
          return res.status(400).json({ success: false, message: `invoice is missing required field: ${key}` });
        }
      }
      const amount = Number(inv.grossAmount != null ? inv.grossAmount : inv.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: "invoice amount must be a positive number" });
      }
      parsed.push({ ...pick(inv, INVOICE_FIELDS), amount });
    }

    // Group by feeType+session so duplicate detection stays within the tenant
    // and is a single $in query per combination.
    const byGroup = new Map();
    for (const inv of parsed) {
      const group = `${inv.feeType}||${inv.session}`;
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(inv);
    }

    const existing = new Set();
    const concessionsByKey = new Map(); // `${group}||${studentId}` -> concession
    await Promise.all(
      [...byGroup.entries()].map(async ([group, groupInvoices]) => {
        const [feeType, session] = group.split("||");
        const ids = [...new Set(groupInvoices.map((inv) => String(inv.studentId)))];
        const [docs, concessionMap] = await Promise.all([
          FeeInvoice.find({
            schoolId: req.tenantId,
            feeType,
            session,
            studentId: { $in: ids },
          })
            .select("studentId")
            .lean(),
          findApplicableConcessions(req.tenantId, ids, { session, feeType }),
        ]);
        for (const doc of docs) existing.add(`${feeType}||${session}||${String(doc.studentId)}`);
        for (const [studentId, concession] of concessionMap) {
          concessionsByKey.set(`${group}||${studentId}`, concession);
        }
      }),
    );

    const seen = new Set();
    const toCreate = [];
    const skipped = [];
    for (const inv of parsed) {
      const key = dupKey(inv);
      if (existing.has(key) || seen.has(key)) {
        skipped.push({ studentId: inv.studentId, feeType: inv.feeType, session: inv.session, reason: "duplicate" });
        continue;
      }
      seen.add(key);
      // Re-derive the net server-side from the requested gross — the stored
      // `amount` is always gross minus the winning Active concession.
      const concession = concessionsByKey.get(`${inv.feeType}||${inv.session}||${String(inv.studentId)}`) || null;
      const applied = applyConcession(inv.amount, concession);
      toCreate.push({
        ...inv,
        grossAmount: applied.grossAmount,
        concessionAmount: applied.concessionAmount,
        ...(concession ? { concessionId: concession._id } : {}),
        amount: applied.amount,
        ...(applied.amount === 0 ? { status: "Paid" } : {}),
        schoolId: req.tenantId,
      });
    }

    // Per-doc creates (rather than a single insertMany) so one duplicate that
    // slips past the pre-fetch in a race — caught by the unique index — is
    // reported as skipped instead of aborting the rest of the batch.
    let created = [];
    let racedDuplicates = 0;
    if (toCreate.length) {
      const results = await Promise.allSettled(toCreate.map((inv) => FeeInvoice.create(inv)));
      created = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
      const rejected = results.filter((r) => r.status === "rejected");
      const duplicates = rejected.filter((r) => r.reason && r.reason.code === 11000);
      const unexpected = rejected.filter((r) => !r.reason || r.reason.code !== 11000);
      racedDuplicates = duplicates.length;
      if (unexpected.length) throw unexpected[0].reason;
    }

    // Idempotent confirm: if every requested invoice already existed, nothing
    // new was created, so respond 200 rather than 201.
    res.status(created.length ? 201 : 200).json({
      success: true,
      created: created.length,
      skipped: skipped.length + racedDuplicates,
      data: created,
      skippedItems: skipped,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

const downloadInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "Invoice ID is required" });

    const invoice = await FeeInvoice.findOne({ _id: id, schoolId: req.tenantId }).lean();
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // Parents/students may only download PDFs for their own linked / own record.
    if (req.user.role === "parent" && !(req.user.linkedStudentIds || []).map(String).includes(String(invoice.studentId))) {
      return res.status(403).json({ success: false, message: "You can only download your linked children's invoices" });
    }
    if (req.user.role === "student" && String(req.user.refId || "") !== String(invoice.studentId)) {
      return res.status(403).json({ success: false, message: "You can only download your own invoice" });
    }

    // Load school info for the PDF header
    let school = {};
    const SchoolModel = mongoose.models.School;
    if (SchoolModel) {
      const doc = await SchoolModel.findById(req.tenantId).select({ name: 1, code: 1, address: 1, city: 1, state: 1, phone: 1, email: 1 }).lean();
      if (doc) school = doc;
    }

    const pdfBuffer = await generateFeeInvoicePdf(invoice, school);
    const filename = `fee-invoice-${invoice.invoiceNumber || invoice._id?.toString()?.slice(-8) || "invoice"}.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createInvoice, getInvoices, generatePreview, confirmGenerate, downloadInvoicePdf };
const { v4: uuidv4 } = require("uuid");
const mongoose = require("mongoose");
const FeeInvoice = require("../models/FeeInvoice");
const Payment = require("../models/Payment");
require("../models/School"); // registers mongoose.models.School for receipts/PDFs
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const {
  applyPaymentToInvoice,
  createPaymentWithReceipt,
  voidPayment,
} = require("../utils/paymentWrite");
const { generateFeeReceiptPdf } = require("../utils/receiptPdf");

const recordPayment = async (req, res) => {
  try {
    const { invoiceId, amount, mode, transactionId, receivedRef, chequeNo, chequeDate, bankName } = req.body;
    const amt = Number(amount);
    const invoice = await FeeInvoice.findOne({ _id: invoiceId, schoolId: req.tenantId });
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!(amt > 0)) return res.status(400).json({ success: false, message: "Payment amount must be greater than 0" });
    if (amt > invoice.amount - invoice.paidAmount)
      return res.status(400).json({ success: false, message: "Payment amount exceeds outstanding balance" });
    if (mode === "Cheque" && !(chequeNo && String(chequeNo).trim()))
      return res.status(400).json({ success: false, message: "Cheque number is required for cheque payments" });

    // 1) Record the receipt first (tenant-unique receiptNo; a duplicate
    //    transaction reference is rejected by the unique index).
    let payment;
    try {
      payment = await createPaymentWithReceipt({
        invoiceId,
        studentId: invoice.studentId,
        amount: amt,
        mode,
        transactionId: transactionId || uuidv4(),
        collectedBy: req.user.name,
        schoolId: req.tenantId,
        receivedRef: receivedRef ? String(receivedRef).trim() : undefined,
        // Cheques enter the clearance lifecycle as Pending (CLIENT-REQ-039).
        ...(mode === "Cheque"
          ? {
              chequeNo: String(chequeNo).trim(),
              chequeDate: chequeDate ? new Date(chequeDate) : undefined,
              bankName: bankName ? String(bankName).trim() : undefined,
              clearanceStatus: "Pending",
            }
          : {}),
      });
    } catch (err) {
      if (err && err.code === 11000 && String(err.message || "").includes("transactionId")) {
        return res.status(409).json({ success: false, message: "This transaction reference has already been recorded" });
      }
      throw err;
    }

    // 2) Credit the invoice atomically — the balance guard runs inside the
    //    update filter, so a concurrent collection can never over-credit.
    const updated = await applyPaymentToInvoice(invoiceId, req.tenantId, amt, {
      receiptNo: payment.receiptNo,
    });
    if (!updated) {
      await voidPayment(payment, `invoice ${invoiceId} failed the balance guard`);
      return res.status(400).json({ success: false, message: "Payment amount exceeds outstanding balance" });
    }

    res.status(201).json({ success: true, data: { payment, invoice: updated } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getPayments = async (req, res) => {
  try {
    const { studentId, mode, clearanceStatus } = req.query;
    const filter = { schoolId: req.tenantId };
    if (studentId) filter.studentId = studentId;
    if (mode) filter.mode = mode;
    if (clearanceStatus) filter.clearanceStatus = clearanceStatus;
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      Payment.find(filter).sort({ paidOn: -1 }).skip(skip).limit(limit),
      Payment.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Receipts are keyed by a guessable receiptNo — students/parents may only
// read receipts of their own linked child, staff with fees:read read any.
const canViewReceipt = (req, payment) => {
  const role = req.user && req.user.role;
  if (role === "student") return String(payment.studentId) === String(req.user.refId);
  if (role === "parent") {
    return (req.user.linkedStudentIds || []).map(String).includes(String(payment.studentId));
  }
  return true;
};

// Everything the receipt UI/PDF needs (school + student + invoice context),
// resolved fail-soft so a missing mirror never breaks receipt retrieval.
const buildReceiptView = async (req, payment) => {
  const invoice = await FeeInvoice.findOne({ _id: payment.invoiceId, schoolId: req.tenantId }).lean();
  let school = {};
  const SchoolModel = mongoose.models.School;
  if (SchoolModel) {
    const doc = await SchoolModel.findById(req.tenantId)
      .select({ name: 1, code: 1, address: 1, city: 1, state: 1, phone: 1, email: 1 })
      .lean();
    if (doc) school = doc;
  }
  let studentName = "";
  try {
    const { getStudentModel } = require("../db/studentDb");
    const Student = await getStudentModel();
    const s = await Student.findOne({ schoolId: req.tenantId, admissionNo: payment.studentId })
      .select("name")
      .lean();
    studentName = (s && s.name) || "";
  } catch {
    studentName = "";
  }
  return { invoice, school, studentName };
};

const getReceipt = async (req, res) => {
  try {
    const { receiptNo } = req.params;
    const payment = await Payment.findOne({ receiptNo, schoolId: req.tenantId });
    if (!payment) return res.status(404).json({ success: false, message: "Receipt not found" });
    if (!canViewReceipt(req, payment)) {
      return res.status(403).json({ success: false, message: "You can only view your own receipts" });
    }
    const { invoice, school, studentName } = await buildReceiptView(req, payment);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    res.json({
      success: true,
      data: {
        payment,
        invoice,
        receiptNo: payment.receiptNo,
        paidOn: payment.paidOn,
        mode: payment.mode,
        amount: payment.amount,
        collectedBy: payment.collectedBy,
        receivedRef: payment.receivedRef || null,
        // Fields the receipt UI renders directly:
        schoolName: school.name || "",
        schoolAddress: [school.address, school.city].filter(Boolean).join(", "),
        studentName,
        studentId: payment.studentId,
        class: invoice.class || "",
        feeType: invoice.feeType || "",
        invoiceAmount: invoice.amount,
        paidAmount: invoice.paidAmount,
        session: invoice.session || "",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Downloadable receipt PDF (CLIENT-REQ-040) — same data contract + scoping
// as getReceipt so the printed and downloaded receipts can never diverge.
const getReceiptPdf = async (req, res) => {
  try {
    const { receiptNo } = req.params;
    const payment = await Payment.findOne({ receiptNo, schoolId: req.tenantId });
    if (!payment) return res.status(404).json({ success: false, message: "Receipt not found" });
    if (!canViewReceipt(req, payment)) {
      return res.status(403).json({ success: false, message: "You can only view your own receipts" });
    }
    const { invoice, school, studentName } = await buildReceiptView(req, payment);
    const pdfBuffer = await generateFeeReceiptPdf({
      payment: payment.toObject ? payment.toObject() : payment,
      invoice: invoice || {},
      school,
      studentName,
    });
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${payment.receiptNo}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getFeeReports = async (req, res) => {
  try {
    const { from, to, class: className, feeType, session } = req.query;
    const schoolId = new mongoose.Types.ObjectId(req.tenantId);

    const paymentMatch = { schoolId };
    if (from || to) {
      paymentMatch.paidOn = {};
      if (from) paymentMatch.paidOn.$gte = new Date(from);
      if (to) paymentMatch.paidOn.$lte = new Date(to);
    }

    const invoiceAdditional = {};
    if (className) invoiceAdditional["invoice.class"] = className;
    if (feeType) invoiceAdditional["invoice.feeType"] = feeType;
    if (session) invoiceAdditional["invoice.session"] = session;

    const [collectionByDate, outstanding, classWiseCollection, feeTypeWiseCollection] = await Promise.all([
      Payment.aggregate([
        { $match: paymentMatch },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidOn" } },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      FeeInvoice.aggregate([
        {
          $match: {
            schoolId,
            $expr: { $lt: ["$paidAmount", "$amount"] },
            ...(className ? { class: className } : {}),
            ...(feeType ? { feeType } : {}),
            ...(session ? { session } : {}),
          },
        },
        {
          $group: {
            _id: { class: "$class", feeType: "$feeType" },
            outstanding: { $sum: { $subtract: ["$amount", "$paidAmount"] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Payment.aggregate([
        { $match: paymentMatch },
        { $lookup: { from: "feeinvoices", localField: "invoiceId", foreignField: "_id", as: "invoice" } },
        { $unwind: "$invoice" },
        { $match: invoiceAdditional },
        {
          $group: {
            _id: "$invoice.class",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Payment.aggregate([
        { $match: paymentMatch },
        { $lookup: { from: "feeinvoices", localField: "invoiceId", foreignField: "_id", as: "invoice" } },
        { $unwind: "$invoice" },
        { $match: invoiceAdditional },
        {
          $group: {
            _id: "$invoice.feeType",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: { collectionByDate, outstanding, classWiseCollection, feeTypeWiseCollection },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reconciliation (CLIENT-REQ-041): mode-wise and cheque-clearance-wise
// totals for a date window. Bounced cheques are reported separately and
// excluded from netCollected — their credit was reversed from the invoice.
const getReconciliation = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { schoolId: req.tenantId };
    if (from || to) {
      match.paidOn = {};
      if (from) match.paidOn.$gte = new Date(from);
      if (to) match.paidOn.$lte = new Date(to);
    }

    const [byMode, byClearance] = await Promise.all([
      Payment.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$mode",
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
            bouncedAmount: {
              $sum: { $cond: [{ $eq: ["$clearanceStatus", "Bounced"] }, "$amount", 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Payment.aggregate([
        { $match: { ...match, mode: "Cheque" } },
        {
          $group: {
            _id: { $ifNull: ["$clearanceStatus", "Pending"] },
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const totalRecorded = byMode.reduce((sum, row) => sum + row.amount, 0);
    const bouncedAmount = byMode.reduce((sum, row) => sum + row.bouncedAmount, 0);

    res.json({
      success: true,
      data: {
        from: from || null,
        to: to || null,
        modes: byMode.map((row) => ({
          mode: row._id,
          count: row.count,
          amount: row.amount,
          bouncedAmount: row.bouncedAmount,
        })),
        chequeClearance: byClearance.map((row) => ({
          status: row._id,
          count: row.count,
          amount: row.amount,
        })),
        totalRecorded,
        bouncedAmount,
        netCollected: totalRecorded - bouncedAmount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Cheque clearance lifecycle (CLIENT-REQ-039). Clearing marks the money
// landed; bouncing retracts the credit from the invoice because the money
// never landed. The bounce uses a conditional update as a once-only mutex —
// two concurrent bounce requests can only ever retract the amount once.
const setChequeClearance = async (req, res) => {
  try {
    const { action, reason } = req.body;
    const payment = await Payment.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    if (payment.mode !== "Cheque") {
      return res.status(400).json({ success: false, message: "Clearance applies only to cheque payments" });
    }

    if (action === "clear") {
      if (payment.clearanceStatus === "Bounced") {
        return res.status(400).json({ success: false, message: "A bounced cheque cannot be cleared" });
      }
      const updated = await Payment.findOneAndUpdate(
        { _id: payment._id, schoolId: req.tenantId, clearanceStatus: { $ne: "Cleared" } },
        { $set: { clearanceStatus: "Cleared", clearedAt: new Date(), clearedBy: req.user.name } },
        { new: true },
      );
      if (!updated) return res.status(409).json({ success: false, message: "Cheque already cleared" });
      return res.json({ success: true, data: updated });
    }

    if (action === "bounce") {
      if (payment.clearanceStatus === "Bounced") {
        return res.status(409).json({ success: false, message: "Cheque already bounced" });
      }
      // Mark first (only one bounce can win), then retract the credit.
      const bounced = await Payment.findOneAndUpdate(
        { _id: payment._id, schoolId: req.tenantId, clearanceStatus: { $ne: "Bounced" } },
        {
          $set: {
            clearanceStatus: "Bounced",
            bouncedReason: (reason && String(reason).trim()) || "Cheque returned by bank",
            bouncedBy: req.user.name,
            bouncedAt: new Date(),
          },
        },
        { new: true },
      );
      if (!bounced) return res.status(409).json({ success: false, message: "Cheque already bounced" });

      const invoice = await applyPaymentToInvoice(payment.invoiceId, req.tenantId, -payment.amount);
      if (!invoice) {
        // Credit could not be retracted (invoice vanished) — put the cheque
        // back to its previous state so ledger and invoice stay consistent.
        await Payment.updateOne(
          { _id: payment._id, schoolId: req.tenantId },
          {
            $set: {
              clearanceStatus: payment.clearanceStatus || "Pending",
              bouncedReason: payment.bouncedReason || undefined,
            },
          },
        );
        return res.status(400).json({ success: false, message: "Invoice not found; cheque bounce rejected" });
      }
      return res.json({ success: true, data: bounced, invoice });
    }

    return res.status(400).json({ success: false, message: "action must be 'clear' or 'bounce'" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { recordPayment, getPayments, getReceipt, getReceiptPdf, setChequeClearance, getReconciliation, getFeeReports };
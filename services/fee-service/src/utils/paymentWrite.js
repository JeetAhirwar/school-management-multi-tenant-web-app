const FeeInvoice = require("../models/FeeInvoice");
const Payment = require("../models/Payment");

// ---------------------------------------------------------------------------
// Atomic fee-payment writes (CLIENT-REQ-034).
//
// The old flow was read-modify-write (`invoice.paidAmount = x + amt; save()`),
// which loses updates under concurrent collections. Every credit now goes
// through applyPaymentToInvoice: a single conditional update that enforces the
// balance in the UPDATE FILTER and recomputes status in the same operation, so
// two racing payments can never over-credit an invoice and the Overdue status
// no longer flip-flops to Partial when a past-due invoice is part-paid.
// ---------------------------------------------------------------------------

const isDupKey = (err, field) =>
  err && err.code === 11000 && String(err.message || "").includes(field);

// Credit an invoice atomically. Returns the updated invoice, or null when the
// guard rejected it (invoice missing / would exceed the balance — caller maps
// null to 400). A negative amt retracts a credit (bounced cheque); the clamp
// keeps paidAmount at >= 0 and the status rules return the invoice to Unpaid.
// Status rules: fully paid -> Paid; nothing paid -> Unpaid/Overdue; past due
// -> Overdue (kept, not downgraded to Partial); otherwise Partial.
const applyPaymentToInvoice = async (invoiceId, schoolId, amt, { receiptNo = null, allowOvercredit = false } = {}) => {
  const now = new Date();
  const rawAfter = { $add: [{ $ifNull: ["$paidAmount", 0] }, amt] };
  const paidAfter = { $max: [0, rawAfter] };
  const guard = allowOvercredit
    ? {}
    : { $expr: { $lte: [rawAfter, { $ifNull: ["$amount", 0] }] } };
  const set = {
    paidAmount: paidAfter,
    status: {
      $switch: {
        branches: [
          { case: { $lte: [{ $ifNull: ["$amount", 0] }, paidAfter] }, then: "Paid" },
          { case: { $lte: [paidAfter, 0] }, then: { $cond: [{ $lt: ["$dueDate", now] }, "Overdue", "Unpaid"] } },
          { case: { $lt: ["$dueDate", now] }, then: "Overdue" },
        ],
        default: "Partial",
      },
    },
  };
  if (receiptNo) set.receiptNo = receiptNo;

  return FeeInvoice.findOneAndUpdate(
    { _id: invoiceId, schoolId, ...guard },
    [{ $set: set }],
    { new: true },
  );
};

const newReceiptNo = () =>
  `RCPT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

// Create a Payment with a tenant-unique receipt number. The {schoolId,
// receiptNo} unique index makes collisions detectable; we remint a few times
// before giving up. A 11000 on transactionId is a genuine duplicate payment
// reference and is rethrown for the caller to map to 409.
const createPaymentWithReceipt = async (data, { attempts = 5 } = {}) => {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await Payment.create({ ...data, receiptNo: newReceiptNo() });
    } catch (err) {
      if (isDupKey(err, "receiptNo")) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Could not allocate a unique receipt number");
};

// Best-effort compensation: remove a Payment that could not be credited to
// its invoice (e.g. lost a balance race). Never throws.
const voidPayment = async (payment, reason) => {
  try {
    await Payment.deleteOne({ _id: payment._id, schoolId: payment.schoolId });
    console.error(`[fee-payments] voided receipt ${payment.receiptNo}: ${reason}`);
  } catch (err) {
    console.error(`[fee-payments] FAILED to void receipt ${payment.receiptNo}: ${err.message}`);
  }
};

module.exports = { applyPaymentToInvoice, createPaymentWithReceipt, voidPayment, newReceiptNo };

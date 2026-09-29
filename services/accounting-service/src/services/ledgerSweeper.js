// The ledger sweeper backfills double-entry journal rows from the two event
// sources (fee receipts / cheque bounces, payroll markPaid) without any
// changes to fee-service or staff-service write paths. It reads the source
// collections through read-only mirrors and upserts by idempotency key, so a
// re-scan can never double-post.
//
// Cadence: one immediate run at boot (historical backfill) + every 5 minutes.
const JournalEntry = require("../models/JournalEntry");
const { ensureSystemAccounts } = require("./coaSeed");
const { getPaymentModel } = require("../db/feeDb");
const { getPayrollModel } = require("../db/staffDb");
const { feeReceiptLines, feeReversalLines, payrollLines } = require("../utils/ledger");

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// Never remove a source-linked entry younger than this — protects the window
// where a payment is being written/voided concurrently with a sweep.
const GRACE_MS = 60 * 1000;

let running = false;
let timer = null;
const seededSchools = new Set();

async function ensureSeeded(schoolId) {
  const key = String(schoolId);
  if (seededSchools.has(key)) return;
  await ensureSystemAccounts(schoolId);
  seededSchools.add(key);
}

async function upsertEntry(schoolId, idemKey, fields) {
  try {
    await JournalEntry.updateOne(
      { schoolId, idemKey },
      { $setOnInsert: { ...fields, schoolId, idemKey, status: "Posted" } },
      { upsert: true }
    );
  } catch (err) {
    // Lost an upsert race against a concurrent sweep — already posted.
    if (err && err.code === 11000) return;
    throw err;
  }
}

async function sweepFees() {
  const Payment = await getPaymentModel();
  const cursor = Payment.find({ amount: { $gt: 0 } })
    .select("schoolId amount mode receiptNo paidOn clearanceStatus createdAt")
    .lean()
    .cursor();
  for await (const payment of cursor) {
    if (!payment.schoolId) continue;
    await ensureSeeded(payment.schoolId);
    const date = payment.paidOn || payment.createdAt || new Date();
    const lines = feeReceiptLines(payment.mode, payment.amount);
    if (lines) {
      await upsertEntry(payment.schoolId, `fee:${payment._id}:primary`, {
        date,
        memo: `Fee receipt ${payment.receiptNo || payment._id}`.slice(0, 500),
        source: "fee",
        refType: "Payment",
        refId: String(payment._id),
        lines,
        createdBy: "system:sweeper",
      });
    }
    // Cheque bounced → mirror the receipt in reverse (income gives back).
    if (payment.clearanceStatus === "Bounced") {
      const reversal = feeReversalLines(payment.mode, payment.amount);
      if (reversal) {
        await upsertEntry(payment.schoolId, `fee:${payment._id}:reversal`, {
          date: payment.bouncedAt || date,
          memo: `Cheque bounce reversal — receipt ${payment.receiptNo || payment._id}`.slice(0, 500),
          source: "fee",
          refType: "Payment",
          refId: String(payment._id),
          lines: reversal,
          createdBy: "system:sweeper",
        });
      }
    }
  }
}

async function sweepPayroll() {
  const Payroll = await getPayrollModel();
  const cursor = Payroll.find({ status: "Paid", netPay: { $gt: 0 } })
    .select("schoolId month year netPay paidOn createdAt")
    .lean()
    .cursor();
  for await (const payroll of cursor) {
    if (!payroll.schoolId) continue;
    await ensureSeeded(payroll.schoolId);
    const lines = payrollLines(payroll.netPay);
    if (!lines) continue;
    await upsertEntry(payroll.schoolId, `payroll:${payroll._id}:paid`, {
      date: payroll.paidOn || payroll.createdAt || new Date(),
      memo: `Payroll ${payroll.month || ""} ${payroll.year || ""}`.trim().slice(0, 500),
      source: "payroll",
      refType: "Payroll",
      refId: String(payroll._id),
      lines,
      createdBy: "system:sweeper",
    });
  }
}

// Voided payments (deleted by fee-service) and payrolls returned to Pending
// leave stale journal rows behind — remove them once past the grace window.
async function cleanupOrphans() {
  const cutoff = new Date(Date.now() - GRACE_MS);

  const Payment = await getPaymentModel();
  const payments = await Payment.find({}).select("_id").lean();
  const paymentIds = new Set(payments.map((p) => String(p._id)));
  const feeEntries = await JournalEntry.find({ source: "fee", createdAt: { $lt: cutoff } })
    .select("_id refId")
    .lean();
  const staleFee = feeEntries.filter((e) => !paymentIds.has(String(e.refId))).map((e) => e._id);
  if (staleFee.length) await JournalEntry.deleteMany({ _id: { $in: staleFee } });

  const Payroll = await getPayrollModel();
  const payrolls = await Payroll.find({}).select("_id status").lean();
  const payrollStatus = new Map(payrolls.map((p) => [String(p._id), p.status]));
  const payrollEntries = await JournalEntry.find({ source: "payroll", createdAt: { $lt: cutoff } })
    .select("_id refId")
    .lean();
  const stalePayroll = payrollEntries
    .filter((e) => payrollStatus.get(String(e.refId)) !== "Paid")
    .map((e) => e._id);
  if (stalePayroll.length) await JournalEntry.deleteMany({ _id: { $in: stalePayroll } });
}

async function sweepOnce() {
  if (running) return;
  running = true;
  try {
    await sweepFees();
    await sweepPayroll();
    await cleanupOrphans();
  } catch (err) {
    console.error("[ledger-sweeper] sweep failed:", (err && err.message) || err);
  } finally {
    running = false;
  }
}

function startLedgerSweeper() {
  if (timer) return;
  sweepOnce(); // boot backfill — errors are caught inside sweepOnce
  timer = setInterval(sweepOnce, SWEEP_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function stopLedgerSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startLedgerSweeper, stopLedgerSweeper, sweepOnce, sweepFees, sweepPayroll, cleanupOrphans };

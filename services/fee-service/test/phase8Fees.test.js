const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const readFe = (rel) =>
  fs.readFileSync(path.join(__dirname, "../../../../Admin-panel/src", rel), "utf8");

const paymentWrite = read("../src/utils/paymentWrite.js");
const paymentCtrl = read("../src/controllers/paymentController.js");
const orderCtrl = read("../src/controllers/paymentOrderController.js");
const invoiceCtrl = read("../src/controllers/invoiceController.js");
const webhookCtrl = read("../src/controllers/paymentWebhookController.js");
const engine = read("../src/utils/paymentEngine.js");
const paymentRoutes = read("../src/routes/paymentRoutes.js");
const orderRoutes = read("../src/routes/paymentOrderRoutes.js");
const concessionRoutes = read("../src/routes/concessionRoutes.js");
const reminders = read("../src/services/feeReminders.js");
const feFees = readFe("pages/FeesCollection.jsx");
const feOnline = readFe("pages/OnlinePayment.jsx");
const feApi = readFe("lib/api.js");

// ---------------------------------------------------------------------------
// P8-A: money atomicity
// ---------------------------------------------------------------------------

test("phase8: FeeInvoice enforces one invoice per student+feeType+session and carries the concession snapshot", () => {
  const FeeInvoice = require("../src/models/FeeInvoice");
  const indexes = FeeInvoice.schema.indexes();
  assert.ok(
    indexes.some(
      ([keys, opts]) =>
        keys.schoolId === 1 &&
        keys.studentId === 1 &&
        keys.feeType === 1 &&
        keys.session === 1 &&
        opts && opts.unique,
    ),
    "expected unique {schoolId,studentId,feeType,session} index",
  );
  assert.ok(FeeInvoice.schema.path("grossAmount"), "grossAmount missing");
  assert.ok(FeeInvoice.schema.path("concessionAmount"), "concessionAmount missing");
  assert.ok(FeeInvoice.schema.path("concessionId"), "concessionId missing");
  assert.deepEqual(
    FeeInvoice.schema.path("status").enumValues,
    ["Unpaid", "Partial", "Paid", "Overdue"],
  );
});

test("phase8: Payment receiptNo and transactionId are tenant-unique (receipt lookup + duplicate refs)", () => {
  const Payment = require("../src/models/Payment");
  const indexes = Payment.schema.indexes();
  const receiptIdx = indexes.find(([keys]) => keys.schoolId === 1 && keys.receiptNo === 1);
  assert.ok(receiptIdx && receiptIdx[1] && receiptIdx[1].unique, "unique {schoolId,receiptNo} missing");
  const txnIdx = indexes.find(([keys]) => keys.schoolId === 1 && keys.transactionId === 1);
  assert.ok(txnIdx && txnIdx[1] && txnIdx[1].unique, "unique {schoolId,transactionId} missing");
  assert.ok(
    txnIdx[1].partialFilterExpression && txnIdx[1].partialFilterExpression.transactionId,
    "transactionId index must stay partial (legacy rows without refs)",
  );
});

test("phase8: Payment carries cheque clearance lifecycle + office reference fields", () => {
  const Payment = require("../src/models/Payment");
  const modes = Payment.schema.path("mode").enumValues;
  for (const m of ["Cheque", "Bank Transfer", "UPI"]) {
    assert.ok(modes.includes(m), `mode "${m}" missing`);
  }
  for (const f of ["receivedRef", "chequeNo", "chequeDate", "bankName", "clearanceStatus", "clearedAt", "clearedBy", "bouncedReason", "bouncedBy", "bouncedAt"]) {
    assert.ok(Payment.schema.path(f), `field ${f} missing`);
  }
  assert.deepEqual(
    Payment.schema.path("clearanceStatus").enumValues,
    ["Pending", "Cleared", "Bounced"],
  );
});

test("phase8: applyPaymentToInvoice guards on the RAW delta, clamps reversals at 0 and restores Unpaid", () => {
  assert.match(paymentWrite, /const rawAfter = \{ \$add:/);
  assert.match(paymentWrite, /const paidAfter = \{ \$max: \[0, rawAfter\] \}/);
  // Overcredit filter must see the unclamped delta…
  assert.match(paymentWrite, /\$lte: \[rawAfter, \{ \$ifNull: \["\$amount", 0\] \}\]/);
  // …while a bounced-cheque reversal never drives paidAmount negative and
  // returns the invoice to Unpaid/Overdue instead of leaving it Partial.
  assert.match(paymentWrite, /\$lte: \[paidAfter, 0\].*\$cond.*\$lt: \["\$dueDate", now\].*Overdue.*Unpaid/s);
  assert.match(paymentWrite, /allowOvercredit/);
  assert.match(paymentWrite, /voidPayment/);
  assert.match(paymentWrite, /newReceiptNo/);
});

test("phase8: recordPayment rejects duplicate transaction refs with 409 and voids on balance-race failure", () => {
  assert.match(paymentCtrl, /err\.code === 11000 && String\(err\.message \|\| ""\)\.includes\("transactionId"\)/);
  assert.match(paymentCtrl, /status\(409\).*already been recorded/s);
  assert.match(paymentCtrl, /await voidPayment\(payment,/);
  assert.match(paymentCtrl, /mode === "Cheque" && !\(chequeNo/);
  assert.match(paymentCtrl, /clearanceStatus: "Pending"/);
});

test("phase8: confirmGenerate re-derives the net from gross server-side and survives per-doc races", () => {
  assert.match(invoiceCtrl, /inv\.grossAmount != null \? inv\.grossAmount : inv\.amount/);
  assert.match(invoiceCtrl, /Promise\.allSettled\(toCreate\.map/);
  assert.match(invoiceCtrl, /racedDuplicates/);
  assert.match(invoiceCtrl, /applyConcession\(inv\.amount, concession\)/);
  assert.match(invoiceCtrl, /concessionId: concession\._id/);
  assert.match(invoiceCtrl, /applied\.amount === 0 \? \{ status: "Paid" \}/);
  // Preview must expose the concession breakdown for the generation UI.
  assert.match(invoiceCtrl, /concessionAmount: applied\.concessionAmount/);
});

// ---------------------------------------------------------------------------
// P8-B: payment methods + manual-confirm queue
// ---------------------------------------------------------------------------

test("phase8: manual-confirm closes the awaiting_manual_confirm dead end with evidence validation", () => {
  assert.match(orderCtrl, /const manualConfirmOrder/);
  assert.match(orderCtrl, /status !== "awaiting_manual_confirm"/);
  assert.match(orderCtrl, /chequeNo/);
  assert.match(orderCtrl, /confirmedBy: `manual:/);
  assert.match(orderRoutes, /post\("\/:id\/manual-confirm", requirePermission\("fees:collect"\)/);
  // Webhook confirm must be readable by the paying roles' fees:read grant.
  assert.match(orderRoutes, /post\("\/:id\/confirm", requirePermission\("fees:read"\)/);
});

test("phase8: createOrder mode override is restricted to the live gateway mode or school-enabled UPI", () => {
  assert.match(orderCtrl, /GATEWAY_MODES/);
  assert.match(orderCtrl, /gateway\.display\.upiId/);
  assert.match(orderCtrl, /initiate.*\["pending", "failed"\]/s);
});

test("phase8: webhook fails the order and rejects amount mismatches", () => {
  assert.match(webhookCtrl, /markOrderFailed/);
  assert.match(webhookCtrl, /AMOUNT_MISMATCH/);
  assert.match(webhookCtrl, /verified\.paymentId && !verified\.captured/);
  assert.match(engine, /upiIntent/);
  assert.match(engine, /const MODE_ROUTING = \{ upi: "UPI", qr: "UPI", bank: "Bank Transfer" \}/);
});

// ---------------------------------------------------------------------------
// P8-C: receipts
// ---------------------------------------------------------------------------

test("phase8: receipt endpoints are read-scoped and the PDF shares the data contract", () => {
  assert.match(paymentRoutes, /get\("\/receipt\/:receiptNo", requirePermission\("fees:read"\)/);
  assert.match(paymentRoutes, /get\("\/receipt\/:receiptNo\/pdf", requirePermission\("fees:read"\)/);
  assert.match(paymentCtrl, /const canViewReceipt/);
  assert.match(paymentCtrl, /role === "student"/);
  assert.match(paymentCtrl, /linkedStudentIds/);
  assert.match(paymentCtrl, /buildReceiptView/);
  assert.ok(paymentCtrl.includes("getReceiptPdf"), "getReceiptPdf not exported");
});

test("phase8: receipt PDF generator produces a real buffer", async () => {
  const { generateFeeReceiptPdf } = require("../src/utils/receiptPdf");
  const buffer = await generateFeeReceiptPdf({
    payment: { receiptNo: "RCPT-T1", amount: 500, mode: "Cheque", chequeNo: "CH1", paidOn: new Date().toISOString(), studentId: "ADM1", collectedBy: "Staff" },
    invoice: { amount: 1000, paidAmount: 500, feeType: "Tuition", class: "5-A" },
    school: { name: "Test School", address: "Addr" },
    studentName: "Test Student",
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000, "suspiciously small PDF");
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
});

// ---------------------------------------------------------------------------
// P8-D: cheque clearance
// ---------------------------------------------------------------------------

test("phase8: bounce is a once-only mutex that retracts the credit, with revert on failure", () => {
  assert.match(paymentCtrl, /const setChequeClearance/);
  assert.match(paymentCtrl, /clearanceStatus: \{ \$ne: "Bounced" \}/);
  assert.match(paymentCtrl, /applyPaymentToInvoice\(payment\.invoiceId, req\.tenantId, -payment\.amount\)/);
  // If the invoice vanished the cheque must go back — ledger stays consistent.
  assert.match(paymentCtrl, /clearanceStatus: payment\.clearanceStatus \|\| "Pending"/);
  assert.match(paymentCtrl, /payment\.mode !== "Cheque"/);
  assert.match(paymentRoutes, /post\("\/:id\/clearance", requirePermission\("fees:collect"\)/);
});

test("phase8: payments list can filter by mode and clearance status", () => {
  assert.match(paymentCtrl, /const \{ studentId, mode, clearanceStatus \} = req\.query/);
  assert.match(paymentCtrl, /if \(mode\) filter\.mode = mode/);
  assert.match(paymentCtrl, /if \(clearanceStatus\) filter\.clearanceStatus = clearanceStatus/);
});

// ---------------------------------------------------------------------------
// P8-E: reconciliation
// ---------------------------------------------------------------------------

test("phase8: reconciliation reports net = recorded minus bounced, by mode and clearance", () => {
  assert.match(paymentCtrl, /const getReconciliation/);
  assert.match(paymentCtrl, /bouncedAmount/);
  assert.match(paymentCtrl, /netCollected: totalRecorded - bouncedAmount/);
  assert.match(paymentCtrl, /mode: "Cheque"/);
  assert.match(paymentRoutes, /get\("\/reconciliation", requirePermission\("fees:reports"\)/);
});

// ---------------------------------------------------------------------------
// P8-F: reminders (sent-once)
// ---------------------------------------------------------------------------

test("phase8: FeeReminder uniqueness is the sent-once guarantee", () => {
  const FeeReminder = require("../src/models/FeeReminder");
  const indexes = FeeReminder.schema.indexes();
  const idx = indexes.find(([keys]) => keys.schoolId === 1 && keys.invoiceId === 1 && keys.channel === 1 && keys.kind === 1);
  assert.ok(idx && idx[1] && idx[1].unique, "unique {schoolId,invoiceId,channel,kind} missing");
  assert.deepEqual(FeeReminder.schema.path("kind").enumValues, ["due_soon", "overdue"]);
  assert.deepEqual(FeeReminder.schema.path("channel").enumValues, ["inapp"]);
});

test("phase8: reminder cron claims before pushing and releases the claim when the push fails", () => {
  assert.match(reminders, /FeeReminder\.create\(\{/);
  assert.match(reminders, /if \(isDupKey\(err\)\)/);
  // Claim -> notify -> release ordering (a failed push must be retried).
  const claimAt = reminders.indexOf("FeeReminder.create(");
  const notifyAt = reminders.indexOf("notifyByRefIds({");
  const releaseAt = reminders.indexOf("FeeReminder.deleteOne({ _id: claim._id })");
  assert.ok(claimAt > -1 && notifyAt > claimAt, "push must happen after the claim");
  assert.ok(releaseAt > notifyAt, "claim release must happen after the push outcome");
  assert.match(reminders, /linkedStudentIds: studentId/);
  assert.match(reminders, /sendEmailViaAuth/);
  assert.match(reminders, /startFeeReminderScheduler/);
});

test("phase8: email relay is gated on SMTP config and routed through the auth internal API", () => {
  const notify = read("../src/utils/notify.js");
  assert.match(notify, /sendEmailViaAuth/);
  assert.match(notify, /process\.env\.SMTP_HOST/);
  assert.match(notify, /api\/auth\/internal\/send-email/);
  const internalRoutes = read("../../auth-service/src/routes/internalRoutes.js");
  assert.match(internalRoutes, /post\("\/send-email", sendInternalEmail\)/);
});

// ---------------------------------------------------------------------------
// P8-G: concessions
// ---------------------------------------------------------------------------

test("phase8: Concession model encodes the requested->active workflow", () => {
  const Concession = require("../src/models/Concession");
  assert.deepEqual(Concession.schema.path("kind").enumValues, ["Sibling", "Scholarship", "Manual"]);
  assert.deepEqual(Concession.schema.path("type").enumValues, ["percent", "flat"]);
  assert.deepEqual(Concession.schema.path("status").enumValues, ["Requested", "Active", "Rejected"]);
  assert.equal(Concession.schema.path("status").defaultValue, "Requested");
  assert.ok(Concession.schema.path("approvedBy"));
  assert.ok(Concession.schema.path("rejectedReason"));
});

test("phase8: applyConcession nets correctly and clamps every edge", () => {
  const { applyConcession } = require("../src/utils/concession");
  assert.deepEqual(applyConcession(1000, { type: "percent", value: 15 }), { grossAmount: 1000, concessionAmount: 150, amount: 850 });
  assert.deepEqual(applyConcession(1000, { type: "flat", value: 200 }), { grossAmount: 1000, concessionAmount: 200, amount: 800 });
  // flat > gross cannot create a negative payable
  assert.deepEqual(applyConcession(300, { type: "flat", value: 500 }), { grossAmount: 300, concessionAmount: 300, amount: 0 });
  // percent > 100 is clamped
  assert.deepEqual(applyConcession(1000, { type: "percent", value: 150 }), { grossAmount: 1000, concessionAmount: 1000, amount: 0 });
  // no concession / zero gross is a no-op
  assert.deepEqual(applyConcession(500, null), { grossAmount: 500, concessionAmount: 0, amount: 500 });
  assert.deepEqual(applyConcession(0, { type: "percent", value: 10 }), { grossAmount: 0, concessionAmount: 0, amount: 0 });
});

test("phase8: concession routes separate read from the approve workflow", () => {
  assert.match(concessionRoutes, /get\("\/", requirePermission\("fees:read"\)/);
  assert.match(concessionRoutes, /post\("\/", requirePermission\("fees:structure"\)/);
  assert.match(concessionRoutes, /patch\("\/:id\/approve", requirePermission\("fees:structure"\)/);
  assert.match(concessionRoutes, /patch\("\/:id\/reject", requirePermission\("fees:structure"\)/);
  // Duplicate live concession per student+kind+session is a 409, rejected rows do not block re-request.
  const concessionCtrl = read("../src/controllers/concessionController.js");
  assert.match(concessionCtrl, /status: \{ \$ne: "Rejected" \}/);
  assert.match(concessionCtrl, /status\(409\)/);
});

test("phase8: index.js boots both cron jobs", () => {
  const index = read("../src/index.js");
  assert.match(index, /startOverdueInvoiceScheduler\(\)/);
  assert.match(index, /startFeeReminderScheduler\(\)/);
  assert.match(index, /app\.use\("\/api\/fees\/concessions", concessionRoutes\)/);
});

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

test("phase8 FE: FeesCollection owns cheque clearance, reconciliation and the concession workflow", () => {
  assert.ok(feFees.includes('"Bank Transfer"'), "Bank Transfer missing from MODES");
  assert.match(feFees, /handleSaveConcession/);
  assert.match(feFees, /Concessions & Scholarships/);
  assert.match(feFees, /api\.fees\.concessions\.approve/);
  assert.match(feFees, /handleClearance/);
  assert.match(feFees, /setClearance/);
  assert.match(feFees, /reports\s*\n?\s*\.reconciliation|reports\s*\.reconciliation/);
  // Preview must follow the BE contract (preview/isDuplicate) and post GROSS
  // amounts so the server re-applies the concession exactly once.
  assert.match(feFees, /invoicePreview\.preview/);
  assert.match(feFees, /!r\.isDuplicate/);
  assert.match(feFees, /amount: r\.grossAmount != null \? r\.grossAmount : r\.amount/);
  assert.match(feFees, /downloadReceiptPdf/);
});

test("phase8 FE: OnlinePayment offers a UPI mode and surfaces the UPI intent checkout", () => {
  assert.match(feOnline, /payload\.mode = payMode/);
  assert.match(feOnline, /chk\.upiIntent \|\| chk\.upiId/);
  assert.match(feOnline, /Open UPI app/);
  assert.match(feOnline, /o\.status === "failed"/);
});

test("phase8 FE: api client exposes every phase-8 endpoint", () => {
  assert.match(feApi, /manualConfirm:/);
  assert.match(feApi, /setClearance:/);
  assert.match(feApi, /downloadReceiptPdf:/);
  assert.match(feApi, /reconciliation:/);
  assert.match(feApi, /concessions: \{/);
  assert.match(feApi, /approve: \(id\)/);
  assert.match(feApi, /reject: \(id, reason\)/);
});

const FeeInvoice = require("../models/FeeInvoice");

const OVERDUE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Mark unpaid/partial fee invoices as Overdue when their dueDate has passed.
 *
 * Flow:
 *   1. Find invoices: status in ["Unpaid", "Partial"] AND dueDate < now
 *   2. Set status = "Overdue"
 *   3. Log summary for observability
 */
const markOverdueInvoices = async () => {
  const now = new Date();
  try {
    const result = await FeeInvoice.updateMany(
      {
        status: { $in: ["Unpaid", "Partial"] },
        dueDate: { $lt: now },
      },
      {
        $set: { status: "Overdue" },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[overdue-invoices] Marked ${result.modifiedCount} invoice(s) as Overdue`);
    }
  } catch (err) {
    console.error("[overdue-invoices] Error marking overdue invoices:", err.message);
  }
};

/**
 * Start periodic overdue invoice check (runs immediately + every hour).
 */
const startOverdueInvoiceScheduler = () => {
  console.log("[overdue-invoices] Starting overdue invoice scheduler (every 1h)");
  markOverdueInvoices(); // run immediately on startup
  setInterval(markOverdueInvoices, OVERDUE_CHECK_INTERVAL_MS);
};

module.exports = { startOverdueInvoiceScheduler, markOverdueInvoices };

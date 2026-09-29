const Subscription = require("../models/Subscription");
const School = require("../models/School");
const Plan = require("../models/Plan");
const BillingInvoice = require("../models/BillingInvoice");

const ACTIVATION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Activate scheduled subscriptions whose startDate has arrived.
 *
 * Flow:
 *   1. Find subscriptions: status="scheduled" AND startDate <= now
 *   2. For each: close current subscription, activate scheduled one
 *   3. Update school.plan, mark invoice as paid
 */
const activateScheduledSubscriptions = async () => {
  const now = new Date();
  try {
    const due = await Subscription.find({
      status: "scheduled",
      startDate: { $lte: now },
    }).populate("planId", "_id code");

    if (!due.length) return;

    for (const sub of due) {
      try {
        const plan = sub.planId && typeof sub.planId === "object" ? sub.planId : await Plan.findById(sub.planId);
        if (!plan) {
          console.error(`[scheduled-activation] Plan not found for subscription ${sub._id}, skipping`);
          continue;
        }

        // Close any current subscription for this school
        const cancelled = await Subscription.find(
          { schoolId: sub.schoolId, status: { $in: ["trialing", "active", "past_due"] } },
          { _id: 1 }
        ).lean();

        await Subscription.updateMany(
          { schoolId: sub.schoolId, status: { $in: ["trialing", "active", "past_due"] } },
          {
            $set: {
              status: "cancelled",
              cancelledAt: now,
              endedAt: now,
              nextBillingDate: null,
              "metadata.closedReason": "scheduled-activation",
            },
          }
        );

        // Mark old invoices as paid
        if (cancelled.length) {
          const subIds = cancelled.map((s) => s._id);
          await BillingInvoice.updateMany(
            { subscriptionId: { $in: subIds }, status: "issued" },
            { $set: { status: "paid", paidAt: now } }
          );
        }

        // Activate the scheduled subscription
        sub.status = "active";
        sub.metadata = { ...sub.metadata, activatedAt: now, activatedBy: "scheduler" };
        await sub.save();

        // Update school plan
        await School.updateOne({ _id: sub.schoolId }, { $set: { plan: plan.code } });

        // Mark linked invoice as paid
        await BillingInvoice.updateMany(
          { subscriptionId: sub._id, status: "issued" },
          { $set: { status: "paid", paidAt: now } }
        );

        console.log(`[scheduled-activation] Activated subscription ${sub._id} for school ${sub.schoolId}`);
      } catch (err) {
        console.error(`[scheduled-activation] Error activating subscription ${sub._id}:`, err.message);
      }
    }

    console.log(`[scheduled-activation] Processed ${due.length} scheduled subscription(s)`);
  } catch (err) {
    console.error("[scheduled-activation] Error:", err.message);
  }
};

/**
 * Start periodic scheduled subscription activation (runs immediately + every 15 min).
 */
const startScheduledActivationScheduler = () => {
  console.log("[scheduled-activation] Starting scheduler (every 15m)");
  activateScheduledSubscriptions(); // run immediately on startup
  setInterval(activateScheduledSubscriptions, ACTIVATION_INTERVAL_MS);
};

module.exports = { startScheduledActivationScheduler, activateScheduledSubscriptions };

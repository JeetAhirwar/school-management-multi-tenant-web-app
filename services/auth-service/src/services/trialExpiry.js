const Subscription = require("../models/Subscription");
const School = require("../models/School");

const EXPIRY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Expire all trials whose trialEndDate has passed.
 *
 * Flow:
 *   1. Find subscriptions: status="trialing" AND trialEndDate <= now
 *   2. Set subscription.status = "expired", subscription.endedAt = now
 *   3. Set school.plan = "trial" AND school.status = "suspended"
 *      (blocks login until school re-activates via payment)
 */
const expireTrials = async () => {
  const now = new Date();
  try {
    const expired = await Subscription.updateMany(
      {
        status: "trialing",
        trialEndDate: { $lte: now },
      },
      {
        $set: { status: "expired", endedAt: now },
      }
    );

    if (expired.modifiedCount > 0) {
      console.log(`[trial-expiry] Expired ${expired.modifiedCount} trial subscription(s)`);

      // Revert school.plan to "trial" AND suspend schools whose trial just expired
      const expiredSubs = await Subscription.find({
        status: "expired",
        endedAt: now,
      }).select("schoolId");

      if (expiredSubs.length > 0) {
        const schoolIds = expiredSubs.map((s) => s.schoolId);
        await School.updateMany(
          { _id: { $in: schoolIds }, plan: { $ne: "trial" } },
          { $set: { plan: "trial", status: "suspended" } }
        );
        console.log(`[trial-expiry] Suspended ${schoolIds.length} school(s) with expired trials`);
      }
    }
  } catch (err) {
    console.error("[trial-expiry] Error expiring trials:", err.message);
  }
};

/**
 * Start periodic trial expiry check (runs immediately + every hour).
 */
const startTrialExpiryScheduler = () => {
  console.log("[trial-expiry] Starting trial expiry scheduler (every 1h)");
  expireTrials(); // run immediately on startup
  setInterval(expireTrials, EXPIRY_INTERVAL_MS);
};

module.exports = { startTrialExpiryScheduler, expireTrials };

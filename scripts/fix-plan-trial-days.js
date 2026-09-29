/**
 * Fix trialDays for existing paid plans in MongoDB.
 *
 * Problem: ensureBillingDefaults uses $setOnInsert, so existing plan
 * documents still have trialDays: 14. When a school upgrades to a paid
 * plan, buildSubscriptionDates sees trialDays > 0 and sets status="trialing"
 * instead of "active".
 *
 * Solution: Set trialDays = 0 for all paid plans (basic/standard/premium).
 *
 * Usage:
 *   node scripts/fix-plan-trial-days.js          (dry run — shows what would change)
 *   node scripts/fix-plan-trial-days.js --apply   (actually updates)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1", "0.0.0.0"]);

const mongoose = require("mongoose");

const PAID_PLAN_CODES = ["basic", "standard", "premium"];

const fixTrialDays = async () => {
  const apply = process.argv.includes("--apply");
  console.log(`\n[fix-plan-trial-days] Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  try {
    await mongoose.connect(process.env.AUTH_MONGODB_URI);
    console.log("[fix-plan-trial-days] Connected to MongoDB");

    const Plan = mongoose.model(
      "Plan",
      new mongoose.Schema(
        {
          code: { type: String },
          name: { type: String },
          trialDays: { type: Number },
          isActive: { type: Boolean },
          isPublic: { type: Boolean },
        },
        { collection: "plans" }
      )
    );

    const plans = await Plan.find({
      code: { $in: PAID_PLAN_CODES },
      isActive: true,
    });

    console.log(`[fix-plan-trial-days] Found ${plans.length} paid plan(s):\n`);

    for (const plan of plans) {
      const needsFix = plan.trialDays !== 0;
      const icon = needsFix ? "⚠️" : "✅";
      console.log(
        `  ${icon} ${plan.code.padEnd(12)} "${plan.name}"  trialDays=${plan.trialDays}${needsFix ? " → 0" : " (already OK)"}`
      );

      if (needsFix && apply) {
        await Plan.updateOne({ _id: plan._id }, { $set: { trialDays: 0 } });
        console.log(`     → Updated`);
      }
    }

    if (!apply) {
      console.log("\n[fix-plan-trial-days] Dry run — no changes made. Re-run with --apply to update.");
    } else {
      console.log("\n[fix-plan-trial-days] Done — all paid plans now have trialDays=0.");
    }
  } catch (err) {
    console.error("[fix-plan-trial-days] Error:", err.message);
  } finally {
    await mongoose.disconnect();
  }
};

fixTrialDays();

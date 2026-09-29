/**
 * Migrate subscription plans: Trial/Basic/Standard/Premium → Trial/1 Year/3 Year/5 Year
 *
 * - Deletes old plans (basic, standard, premium)
 * - Upserts new plans (yearly, three_year, five_year)
 * - Updates existing schools: plan "basic"→"yearly", "standard"→"three_year", "premium"→"five_year"
 * - Deletes orphaned subscriptions linked to deleted plan IDs
 *
 * Usage:
 *   node scripts/migrate-plans.js           (dry run)
 *   node scripts/migrate-plans.js --apply   (actually update)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1", "0.0.0.0"]);

const mongoose = require("mongoose");

const PLAN_MIGRATION = { basic: "yearly", standard: "three_year", premium: "five_year" };

const NEW_PLANS = [
  {
    name: "Trial", code: "trial", description: "Free trial to explore the platform",
    price: 0, currency: "INR", billingCycle: "yearly", trialDays: 30, sortOrder: 1, isActive: true, isPublic: true,
    features: ["Up to 50 students","Core ERP modules","Student management","Staff management","Attendance management","Fee management","Admission management","Library management","Communication","Basic reports","Email support"],
    limits: { students: 50, staff: 10, teachers: 5, adminUsers: 2, branches: 1, storageGB: 5 },
  },
  {
    name: "1 Year", code: "yearly", description: "Full ERP access for schools with a 1-year subscription",
    price: 24999, currency: "INR", billingCycle: "yearly", trialDays: 14, sortOrder: 2, isActive: true, isPublic: true,
    features: ["Up to 1,000 students","All core ERP modules","Student management","Staff management","Attendance management","Fee management","Admission management","Library management","Communication","Leave management","Facility management","Reports and analytics","Data export","Master data management","School settings","Standard support"],
    limits: { students: 1000, staff: 100, teachers: 75, adminUsers: 10, branches: 1, storageGB: 100 },
  },
  {
    name: "3 Year", code: "three_year", description: "Best value for schools looking for long-term ERP access",
    price: 64999, currency: "INR", billingCycle: "yearly", trialDays: 14, sortOrder: 3, isActive: true, isPublic: true,
    features: ["Up to 2,500 students","All ERP modules","Student management","Staff management","Attendance management","Fee management","Admission management","Library management","Communication","Leave management","Facility management","Reports and analytics","Data export","Master data management","Multi-branch support","Advanced reports","Priority support","Free product updates"],
    limits: { students: 2500, staff: 250, teachers: 180, adminUsers: 15, branches: 3, storageGB: 300 },
  },
  {
    name: "5 Year", code: "five_year", description: "Long-term ERP solution for established schools and institutions",
    price: 99999, currency: "INR", billingCycle: "yearly", trialDays: 14, sortOrder: 4, isActive: true, isPublic: true,
    features: ["Up to 5,000 students","All ERP modules","Student management","Staff management","Attendance management","Fee management","Admission management","Library management","Communication","Leave management","Facility management","Reports and analytics","Data export","Master data management","Multi-branch support","Advanced analytics","Priority support","Premium onboarding","Free product updates","Long-term data retention"],
    limits: { students: 5000, staff: 500, teachers: 350, adminUsers: 25, branches: 5, storageGB: 500 },
  },
];

const migrate = async () => {
  const apply = process.argv.includes("--apply");
  console.log(`\n[migrate-plans] Mode: ${apply ? "APPLY" : "DRY RUN"}\n`);

  await mongoose.connect(process.env.AUTH_MONGODB_URI);
  console.log("[migrate-plans] Connected to MongoDB\n");

  const db = mongoose.connection.db;

  // 1. Delete old plans
  const oldCodes = Object.keys(PLAN_MIGRATION);
  const oldPlans = await db.collection("plans").find({ code: { $in: oldCodes } }).toArray();
  console.log(`[migrate-plans] Old plans found: ${oldPlans.length}`);
  for (const p of oldPlans) {
    console.log(`  - ${p.code} "${p.name}" ₹${p.price} (${p._id})`);
  }

  if (apply && oldPlans.length > 0) {
    const del = await db.collection("plans").deleteMany({ code: { $in: oldCodes } });
    console.log(`  → Deleted ${del.deletedCount} old plan(s)\n`);
  }

  // 2. Upsert new plans
  console.log("[migrate-plans] New plans to seed:");
  for (const planData of NEW_PLANS) {
    console.log(`  - ${planData.code} "${planData.name}" ₹${planData.price} yearly, trial=${planData.trialDays}d`);
    if (apply) {
      await db.collection("plans").updateOne(
        { code: planData.code },
        { $set: planData },
        { upsert: true }
      );
    }
  }

  // 3. Update existing schools
  console.log("\n[migrate-plans] School plan migration:");
  const schools = await db.collection("schools").find({ plan: { $in: oldCodes } }).toArray();
  console.log(`  Schools to update: ${schools.length}`);
  for (const s of schools) {
    const newPlan = PLAN_MIGRATION[s.plan] || "trial";
    console.log(`  - ${s.name} (${s.code}): ${s.plan} → ${newPlan}`);
    if (apply) {
      await db.collection("schools").updateOne({ _id: s._id }, { $set: { plan: newPlan } });
    }
  }

  // 4. Clean orphaned subscriptions
  if (apply) {
    const oldPlanIds = oldPlans.map((p) => p._id);
    if (oldPlanIds.length > 0) {
      const orph = await db.collection("subscriptions").deleteMany({ planId: { $in: oldPlanIds } });
      console.log(`\n[migrate-plans] Orphaned subscriptions deleted: ${orph.deletedCount}`);
    }
  }

  // 5. Verify
  if (apply) {
    const finalPlans = await db.collection("plans").find({ isActive: true }).sort({ sortOrder: 1 }).toArray();
    console.log("\n[migrate-plans] Final plans:");
    for (const p of finalPlans) {
      console.log(`  ${p.sortOrder}. ${p.code} "${p.name}" ₹${p.price} ${p.billingCycle} trial=${p.trialDays}d`);
    }
  }

  if (!apply) {
    console.log("\n[migrate-plans] Dry run — no changes. Re-run with --apply to update.");
  } else {
    console.log("\n[migrate-plans] Done.");
  }

  await mongoose.disconnect();
};

migrate().catch((err) => { console.error("[migrate-plans] Error:", err.message); process.exit(1); });

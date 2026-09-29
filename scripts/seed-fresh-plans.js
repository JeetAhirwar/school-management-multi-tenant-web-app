/**
 * Fresh seed: Trial/Basic/Standard/Premium (monthly + yearly)
 *
 * Usage:
 *   node scripts/seed-fresh-plans.js           (dry run)
 *   node scripts/seed-fresh-plans.js --apply   (actually update)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1", "0.0.0.0"]);
const mongoose = require("mongoose");

const FRESH_PLANS = [
  // ── Trial ──────────────────────────────────────────
  {
    name: "Trial", code: "trial", description: "Free trial to explore the platform",
    price: 0, currency: "INR", billingCycle: "monthly", trialDays: 14, sortOrder: 1, isActive: true, isPublic: true,
    features: ["Up to 50 students", "Core modules", "Email support"],
    limits: { students: 50, staff: 10, teachers: 5, adminUsers: 2, branches: 1, storageGB: 5 },
  },
  // ── Basic Monthly ──────────────────────────────────
  {
    name: "Basic", code: "basic", description: "For growing schools",
    price: 999, currency: "INR", billingCycle: "monthly", trialDays: 0, sortOrder: 2, isActive: true, isPublic: true,
    features: ["Up to 500 students", "All core modules", "1 branch", "Standard support"],
    limits: { students: 500, staff: 60, teachers: 40, adminUsers: 5, branches: 1, storageGB: 50 },
  },
  // ── Basic Yearly ───────────────────────────────────
  {
    name: "Basic Yearly", code: "basic_yearly", description: "For growing schools — yearly billing",
    price: 9999, currency: "INR", billingCycle: "yearly", trialDays: 0, sortOrder: 3, isActive: true, isPublic: true,
    features: ["Up to 500 students", "All core modules", "1 branch", "Standard support"],
    limits: { students: 500, staff: 60, teachers: 40, adminUsers: 5, branches: 1, storageGB: 50 },
  },
  // ── Standard Monthly ───────────────────────────────
  {
    name: "Standard", code: "standard", description: "For established schools (multi-branch)",
    price: 2499, currency: "INR", billingCycle: "monthly", trialDays: 0, sortOrder: 4, isActive: true, isPublic: true,
    features: ["Up to 2,000 students", "All core modules", "Up to 3 branches", "Priority support"],
    limits: { students: 2000, staff: 250, teachers: 150, adminUsers: 10, branches: 3, storageGB: 200 },
  },
  // ── Standard Yearly ────────────────────────────────
  {
    name: "Standard Yearly", code: "standard_yearly", description: "For established schools — yearly billing",
    price: 24999, currency: "INR", billingCycle: "yearly", trialDays: 0, sortOrder: 5, isActive: true, isPublic: true,
    features: ["Up to 2,000 students", "All core modules", "Up to 3 branches", "Priority support"],
    limits: { students: 2000, staff: 250, teachers: 150, adminUsers: 10, branches: 3, storageGB: 200 },
  },
  // ── Premium Monthly ────────────────────────────────
  {
    name: "Premium", code: "premium", description: "For large institutions & chains",
    price: 4999, currency: "INR", billingCycle: "monthly", trialDays: 0, sortOrder: 6, isActive: true, isPublic: true,
    features: ["Unlimited students", "All modules + event/transport", "Unlimited branches", "Dedicated success manager"],
    limits: { students: null, staff: null, teachers: null, adminUsers: null, branches: null, storageGB: null },
  },
  // ── Premium Yearly ─────────────────────────────────
  {
    name: "Premium Yearly", code: "premium_yearly", description: "For large institutions — yearly billing",
    price: 49999, currency: "INR", billingCycle: "yearly", trialDays: 0, sortOrder: 7, isActive: true, isPublic: true,
    features: ["Unlimited students", "All modules + event/transport", "Unlimited branches", "Dedicated success manager"],
    limits: { students: null, staff: null, teachers: null, adminUsers: null, branches: null, storageGB: null },
  },
];

const seed = async () => {
  const apply = process.argv.includes("--apply");
  console.log(`\n[seed-fresh] Mode: ${apply ? "APPLY" : "DRY RUN"}\n`);

  await mongoose.connect(process.env.AUTH_MONGODB_URI);
  const db = mongoose.connection.db;
  console.log("[seed-fresh] Connected to MongoDB\n");

  // 1. Show current plans
  const oldPlans = await db.collection("plans").find({}).sort({ sortOrder: 1 }).toArray();
  console.log(`[seed-fresh] Current plans: ${oldPlans.length}`);
  for (const p of oldPlans) console.log(`  - ${p.code} "${p.name}" ₹${p.price} ${p.billingCycle}`);

  // 2. Wipe all old plans
  if (apply) {
    const del = await db.collection("plans").deleteMany({});
    console.log(`\n  → Deleted ${del.deletedCount} old plan(s)`);
  }

  // 3. Seed fresh plans
  console.log(`\n[seed-fresh] Seeding ${FRESH_PLANS.length} plans:`);
  for (const p of FRESH_PLANS) {
    console.log(`  + ${p.code} "${p.name}" ₹${p.price} ${p.billingCycle}`);
    if (apply) {
      await db.collection("plans").updateOne({ code: p.code }, { $set: p }, { upsert: true });
    }
  }

  // 4. Fix school.plan if it has invalid codes
  const validCodes = ["trial", "basic", "standard", "premium"];
  const schools = await db.collection("schools").find({}).toArray();
  for (const s of schools) {
    if (!validCodes.includes(s.plan)) {
      console.log(`\n  School "${s.name}" (${s.code}): plan "${s.plan}" → "basic"`);
      if (apply) {
        await db.collection("schools").updateOne({ _id: s._id }, { $set: { plan: "basic" } });
      }
    }
  }

  // 5. Delete orphaned subscriptions (linked to wiped plan IDs)
  if (apply) {
    const allPlanIds = (await db.collection("plans").find({}).toArray()).map(p => p._id);
    const orph = await db.collection("subscriptions").deleteMany({ planId: { $nin: allPlanIds } });
    console.log(`\n  → Orphaned subscriptions deleted: ${orph.deletedCount}`);
  }

  // 6. Verify
  if (apply) {
    const finalPlans = await db.collection("plans").find({}).sort({ sortOrder: 1 }).toArray();
    console.log("\n[seed-fresh] Final plans:");
    for (const p of finalPlans) console.log(`  ${p.sortOrder}. ${p.code} "${p.name}" ₹${p.price} ${p.billingCycle}`);
  }

  if (!apply) {
    console.log("\n[seed-fresh] Dry run — no changes. Re-run with --apply to update.");
  } else {
    console.log("\n[seed-fresh] Done.");
  }

  await mongoose.disconnect();
};

seed().catch((err) => { console.error("[seed-fresh] Error:", err.message); process.exit(1); });

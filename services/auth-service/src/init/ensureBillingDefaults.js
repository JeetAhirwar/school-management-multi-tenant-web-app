const Plan = require("../models/Plan");
const School = require("../models/School");
const Subscription = require("../models/Subscription");
const {
  CURRENT_SUBSCRIPTION_STATUSES,
} = require("../models/Subscription");

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

// Default catalog. Idempotent: existing plans are left untouched ($setOnInsert),
// so platform edits to prices/features survive service restarts.
const DEFAULT_PLANS = [
  {
    name: "Trial",
    code: "trial",
    description: "Free trial to explore the platform",
    price: 0,
    currency: "INR",
    billingCycle: "monthly",
    trialDays: 14,
    features: [
      "Up to 50 students",
      "Core modules",
      "Email support",
    ],
    limits: { students: 50, staff: 10, teachers: 5, adminUsers: 2, branches: 1, storageGB: 5 },
    isActive: true,
    isPublic: true,
    sortOrder: 1,
  },
  {
    name: "Basic",
    code: "basic",
    description: "For growing schools",
    price: 999,
    currency: "INR",
    billingCycle: "monthly",
    trialDays: 0,
    features: [
      "Up to 500 students",
      "All core modules",
      "1 branch",
      "Standard support",
    ],
    limits: { students: 500, staff: 60, teachers: 40, adminUsers: 5, branches: 1, storageGB: 50 },
    isActive: true,
    isPublic: true,
    sortOrder: 2,
  },
  {
    name: "Basic Yearly",
    code: "basic_yearly",
    description: "For growing schools — yearly billing",
    price: 9999,
    currency: "INR",
    billingCycle: "yearly",
    trialDays: 0,
    features: [
      "Up to 500 students",
      "All core modules",
      "1 branch",
      "Standard support",
    ],
    limits: { students: 500, staff: 60, teachers: 40, adminUsers: 5, branches: 1, storageGB: 50 },
    isActive: true,
    isPublic: true,
    sortOrder: 3,
  },
  {
    name: "Standard",
    code: "standard",
    description: "For established schools (multi-branch)",
    price: 2499,
    currency: "INR",
    billingCycle: "monthly",
    trialDays: 0,
    features: [
      "Up to 2,000 students",
      "All core modules",
      "Up to 3 branches",
      "Priority support",
    ],
    limits: { students: 2000, staff: 250, teachers: 150, adminUsers: 10, branches: 3, storageGB: 200 },
    isActive: true,
    isPublic: true,
    sortOrder: 4,
  },
  {
    name: "Standard Yearly",
    code: "standard_yearly",
    description: "For established schools — yearly billing",
    price: 24999,
    currency: "INR",
    billingCycle: "yearly",
    trialDays: 0,
    features: [
      "Up to 2,000 students",
      "All core modules",
      "Up to 3 branches",
      "Priority support",
    ],
    limits: { students: 2000, staff: 250, teachers: 150, adminUsers: 10, branches: 3, storageGB: 200 },
    isActive: true,
    isPublic: true,
    sortOrder: 5,
  },
  {
    name: "Premium",
    code: "premium",
    description: "For large institutions & chains",
    price: 4999,
    currency: "INR",
    billingCycle: "monthly",
    trialDays: 0,
    features: [
      "Unlimited students",
      "All modules + event/transport",
      "Unlimited branches",
      "Dedicated success manager",
    ],
    limits: { students: null, staff: null, teachers: null, adminUsers: null, branches: null, storageGB: null },
    isActive: true,
    isPublic: true,
    sortOrder: 6,
  },
  {
    name: "Premium Yearly",
    code: "premium_yearly",
    description: "For large institutions — yearly billing",
    price: 49999,
    currency: "INR",
    billingCycle: "yearly",
    trialDays: 0,
    features: [
      "Unlimited students",
      "All modules + event/transport",
      "Unlimited branches",
      "Dedicated success manager",
    ],
    limits: { students: null, staff: null, teachers: null, adminUsers: null, branches: null, storageGB: null },
    isActive: true,
    isPublic: true,
    sortOrder: 7,
  },
];

const buildDates = (plan, startDate) => {
  const start = new Date(startDate || new Date());
  const dates = {
    startDate: start,
    currentPeriodStart: start,
    trialStartDate: null,
    trialEndDate: null,
    currentPeriodEnd: null,
    nextBillingDate: null,
    status: plan.trialDays > 0 ? "trialing" : "active",
  };
  if (plan.trialDays > 0) {
    dates.trialStartDate = start;
    dates.trialEndDate = addDays(start, plan.trialDays);
    dates.currentPeriodEnd = dates.trialEndDate;
    dates.nextBillingDate = dates.trialEndDate;
  } else {
    const cycleMonths = plan.billingCycle === "yearly" ? 12 : 1;
    dates.currentPeriodEnd = addMonths(start, cycleMonths);
    dates.nextBillingDate = dates.currentPeriodEnd;
  }
  return dates;
};

const ensureBillingDefaults = async () => {
  try {
    // 1. Upsert default plan catalog.
    const planCache = {};
    for (const planData of DEFAULT_PLANS) {
      await Plan.updateOne(
        { code: planData.code },
        { $setOnInsert: planData },
        { upsert: true }
      );
      const plan = await Plan.findOne({ code: planData.code }).lean();
      planCache[plan.code] = plan;
    }

    // 2. Backfill ONE current subscription per school that lacks one, derived
    //    from the school's configured plan code. Idempotent and race-safe: the
    //    partial unique index rejects duplicates so a concurrent boot cannot
    //    create two current subscriptions.
    const schools = await School.find({}).select("_id plan name schoolCode").lean();
    let created = 0;
    for (const school of schools) {
      const existing = await Subscription.findOne({
        schoolId: school._id,
        status: { $in: CURRENT_SUBSCRIPTION_STATUSES },
      }).lean();
      if (existing) continue;

      const plan =
        planCache[school.plan] ||
        planCache.trial ||
        (await Plan.findOne({ code: "trial" }).lean());
      if (!plan) continue;

      const dates = buildDates(plan);
      const sub = new Subscription({
        schoolId: school._id,
        planId: plan._id,
        status: dates.status,
        startDate: dates.startDate,
        trialStartDate: dates.trialStartDate,
        trialEndDate: dates.trialEndDate,
        currentPeriodStart: dates.currentPeriodStart,
        currentPeriodEnd: dates.currentPeriodEnd,
        nextBillingDate: dates.nextBillingDate,
        billingCycle: plan.billingCycle,
        price: plan.price,
        currency: plan.currency,
        metadata: { source: "ensure-billing-defaults" },
      });
      try {
        await sub.save();
        created++;
      } catch (err) {
        if (err.code === 11000) continue;
        throw err;
      }
    }

    console.log(
      `[auth-service] ensureBillingDefaults OK: ${Object.keys(planCache).length} plans, ${created} subscriptions created`
    );
  } catch (err) {
    console.error("[auth-service] ensureBillingDefaults failed:", err.message);
  }
};

module.exports = ensureBillingDefaults;
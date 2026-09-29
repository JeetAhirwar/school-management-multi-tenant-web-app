const mongoose = require("mongoose");
const crypto = require("crypto");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const {
  CURRENT_SUBSCRIPTION_STATUSES,
} = require("../models/Subscription");
const BillingInvoice = require("../models/BillingInvoice");
const School = require("../models/School");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const PlatformSetting = require("../models/PlatformSetting");
const AcademicSession = require("../models/AcademicSession");
const { writeAudit } = require("../utils/audit");
const { sendEmail } = require("../utils/email");

// --------------------------------------------------------------------------
// Small domain helpers
// --------------------------------------------------------------------------

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
// Escapes regex metacharacters in user search terms to prevent regex
// injection / ReDoS-style patterns; length-capped to bound scan cost.
const escapeRegex = (term) =>
  String(term).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

const generateInvoiceNumber = () => {
  const year = new Date().getUTCFullYear();
  return `INV-${year}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
};

const asObjectId = (value, field) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    const err = new Error(`${field} is invalid`);
    err.status = 400;
    throw err;
  }
  return mongoose.Types.ObjectId.createFromHexString(String(value));
};

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isNullableLimit = (v) => v === null || v === undefined || (isFiniteNumber(v) && v >= 0);

// Build billing dates for a new subscription. Trial wins while it is running.
const buildSubscriptionDates = (plan, startDate, durationPeriods = 1) => {
  const start = new Date(startDate || new Date());
  const dur = Math.max(1, Math.min(99, Math.floor(Number(durationPeriods) || 1)));
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
    const totalMonths = cycleMonths * dur;
    dates.currentPeriodEnd = addMonths(start, totalMonths);
    dates.nextBillingDate = dates.currentPeriodEnd;
  }
  return dates;
};

// Atomically close any current subscription for a school so the partial unique
// index never allows two current subscriptions to coexist.
const closeCurrentSubscriptions = async (schoolId, { reason = "superseded", extra = {} } = {}) => {
  const cancelled = await Subscription.find(
    { schoolId, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } },
    { _id: 1 }
  ).lean();
  await Subscription.updateMany(
    { schoolId, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        endedAt: new Date(),
        nextBillingDate: null,
        "metadata.closedReason": reason,
        ...extra,
      },
    }
  );
  if (cancelled.length) {
    const subIds = cancelled.map((s) => s._id);
    await BillingInvoice.updateMany(
      { subscriptionId: { $in: subIds }, status: "issued" },
      { $set: { status: "paid", paidAt: new Date() } }
    );
  }
};

const formatMoney = (planOrSub) => ({
  amount: planOrSub.price,
  currency: planOrSub.currency,
  cycle: planOrSub.billingCycle,
});

const toSubscriptionJson = (raw) => {
  const school = raw.schoolId && raw.schoolId._id ? raw.schoolId : { _id: raw.schoolId };
  const plan = raw.planId && raw.planId._id ? raw.planId : { _id: raw.planId };
  return {
    _id: raw._id,
    school: school._id
      ? { _id: school._id, name: school.name, code: school.code, shortName: school.shortName, status: school.status }
      : null,
    plan: plan._id
      ? { _id: plan._id, name: plan.name, code: plan.code, price: plan.price, currency: plan.currency, billingCycle: plan.billingCycle, trialDays: plan.trialDays }
      : null,
    status: raw.status,
    startDate: raw.startDate,
    trialStartDate: raw.trialStartDate,
    trialEndDate: raw.trialEndDate,
    currentPeriodStart: raw.currentPeriodStart,
    currentPeriodEnd: raw.currentPeriodEnd,
    nextBillingDate: raw.nextBillingDate,
    cancelledAt: raw.cancelledAt,
    suspendedAt: raw.suspendedAt,
    endedAt: raw.endedAt,
    billingCycle: raw.billingCycle,
    price: raw.price,
    currency: raw.currency,
    paymentProvider: raw.paymentProvider,
    durationPeriods: raw.durationPeriods || 1,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

const toInvoiceJson = (raw) => ({
  _id: raw._id,
  invoiceNumber: raw.invoiceNumber,
  school: raw.schoolId && raw.schoolId._id
    ? { _id: raw.schoolId._id, name: raw.schoolId.name, code: raw.schoolId.code }
    : { _id: raw.schoolId, name: raw.schoolName || undefined, code: raw.schoolCode || undefined },
  subscriptionId: raw.subscriptionId && raw.subscriptionId._id ? raw.subscriptionId._id : raw.subscriptionId,
  amount: raw.amount,
  currency: raw.currency,
  taxAmount: raw.taxAmount || 0,
  totalAmount: raw.totalAmount || raw.amount,
  gstRate: raw.gstRate || 0,
  cgstAmount: raw.cgstAmount || 0,
  sgstAmount: raw.sgstAmount || 0,
  status: raw.status,
  periodStart: raw.periodStart,
  periodEnd: raw.periodEnd,
  dueDate: raw.dueDate,
  paidAt: raw.paidAt,
  planName: raw.planName || null,
  planCode: raw.planCode || null,
  durationPeriods: raw.durationPeriods || 1,
  paymentOrderId: raw.paymentOrderId || null,
  createdAt: raw.createdAt,
});

const paginate = (req, defaultLimit = 25) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

const rawError = (res, err) => {
  if (err.status) return res.status(err.status).json({ success: false, message: err.message });
  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate entry violates a unique constraint" });
  }
  console.error("[platform] unexpected error:", err.message);
  return res.status(500).json({ success: false, message: "Something went wrong" });
};

// --------------------------------------------------------------------------
// Plan validation (explicit whitelist — mass assignment protection)
// --------------------------------------------------------------------------

const PLAN_FIELDS = [
  "name",
  "code",
  "description",
  "price",
  "currency",
  "billingCycle",
  "trialDays",
  "features",
  "limits",
  "isActive",
  "isPublic",
  "sortOrder",
];
const LIMIT_FIELDS = ["students", "staff", "teachers", "adminUsers", "branches", "storageGB"];

function sanitizePlanPayload(body) {
  const out = {};
  for (const key of PLAN_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (out.name !== undefined) out.name = String(out.name).trim();
  if (out.code !== undefined) out.code = String(out.code).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (out.description !== undefined) out.description = String(out.description).trim();
  if (out.currency !== undefined) out.currency = String(out.currency).trim().toUpperCase();
  if (out.features !== undefined) out.features = (Array.isArray(out.features) ? out.features : []).map((f) => String(f).trim()).filter(Boolean);
  if (out.limits !== undefined) {
    const clean = {};
    for (const key of LIMIT_FIELDS) {
      if (out.limits[key] !== undefined && out.limits[key] !== null && out.limits[key] !== "") {
        clean[key] = Number(out.limits[key]);
      } else if (out.limits[key] !== undefined) {
        clean[key] = null;
      }
    }
    out.limits = clean;
  }
  return out;
}

function validatePlanPayload(payload, { partial = false } = {}) {
  if (!partial || payload.name !== undefined) {
    if (!payload.name || payload.name.length < 2) {
      const err = new Error("Plan name must be at least 2 characters");
      err.status = 400;
      throw err;
    }
  }
  if (!partial || payload.code !== undefined) {
    if (!payload.code || payload.code.length < 2) {
      const err = new Error("Plan code is required");
      err.status = 400;
      throw err;
    }
  }
  if (payload.price !== undefined) {
    if (!isFiniteNumber(payload.price) || payload.price < 0) {
      const err = new Error("Price must be a number >= 0");
      err.status = 400;
      throw err;
    }
  }
  if (payload.currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(payload.currency)) {
      const err = new Error("Currency must be a 3-letter code (e.g. INR)");
      err.status = 400;
      throw err;
    }
  }
  if (payload.billingCycle !== undefined && !["monthly", "yearly"].includes(payload.billingCycle)) {
    const err = new Error("Billing cycle must be monthly or yearly");
    err.status = 400;
    throw err;
  }
  if (payload.trialDays !== undefined && (!isFiniteNumber(payload.trialDays) || payload.trialDays < 0)) {
    const err = new Error("Trial days must be a number >= 0");
    err.status = 400;
    throw err;
  }
  if (payload.sortOrder !== undefined && !isFiniteNumber(payload.sortOrder)) {
    const err = new Error("Sort order must be a number");
    err.status = 400;
    throw err;
  }
  if (payload.limits !== undefined) {
    for (const key of Object.keys(payload.limits)) {
      if (!LIMIT_FIELDS.includes(key) || !isNullableLimit(payload.limits[key])) {
        const err = new Error(`Invalid limit: ${key} (use a number >= 0 or null for unlimited)`);
        err.status = 400;
        throw err;
      }
    }
  }
}

// --------------------------------------------------------------------------
// Plan handlers
// --------------------------------------------------------------------------

const listPlans = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    const { page, limit, skip } = paginate(req);
    const [plans, total] = await Promise.all([
      Plan.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Plan.countDocuments(filter),
    ]);
    res.json({ success: true, count: plans.length, total, page, limit, pages: Math.ceil(total / limit), data: plans });
  } catch (err) {
    rawError(res, err);
  }
};

const getPlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, data: plan });
  } catch (err) {
    rawError(res, err);
  }
};

const createPlan = async (req, res) => {
  try {
    const payload = sanitizePlanPayload(req.body || {});
    validatePlanPayload(payload);
    const exists = await Plan.findOne({ code: payload.code });
    if (exists) return res.status(409).json({ success: false, message: "Plan code already exists" });
    const plan = await Plan.create(payload);
    await writeAudit({ req, user: req.user, action: "plan.created", targetType: "plan", targetId: plan._id, message: `Created plan ${payload.code}` });
    res.status(201).json({ success: true, message: "Plan created", data: plan });
  } catch (err) {
    rawError(res, err);
  }
};

const updatePlan = async (req, res) => {
  try {
    const payload = sanitizePlanPayload(req.body || {});
    validatePlanPayload(payload, { partial: true });
    const exists = await Plan.findOne({ code: payload.code, _id: { $ne: req.params.id } });
    if (exists) return res.status(409).json({ success: false, message: "Plan code already exists" });
    const plan = await Plan.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    await writeAudit({ req, user: req.user, action: "plan.updated", targetType: "plan", targetId: plan._id, message: `Updated plan ${plan.code}` });
    res.json({ success: true, message: "Plan updated", data: plan });
  } catch (err) {
    rawError(res, err);
  }
};

// Hard delete only allowed when the plan has no subscription history at all.
const deletePlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    const used = await Subscription.exists({ planId: plan._id });
    if (used) {
      return res.status(409).json({ success: false, message: "Plan has subscription history — deactivate instead of deleting" });
    }
    await Plan.deleteOne({ _id: plan._id });
    res.json({ success: true, message: "Plan deleted" });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Subscription handlers
// --------------------------------------------------------------------------

const loadSubscription = async (id) => {
  const sub = await Subscription.findById(id)
    .populate("schoolId", "_id name code shortName status")
    .populate("planId", "_id name code price currency billingCycle trialDays")
    .lean();
  return sub;
};

const listSubscriptions = async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req);
    const filter = {};

    if (req.query.schoolId) filter.schoolId = asObjectId(req.query.schoolId, "schoolId");
    if (req.query.plan) filter.planId = asObjectId(req.query.plan, "plan");
    if (req.query.status) filter.status = req.query.status;

    // "Expiring within N days" — reference date is trial end (trialing) or next
    // billing date (active/past_due). Enables the operator's 7/15/30-day buckets.
    if (req.query.expiringWithin) {
      const days = parseInt(req.query.expiringWithin, 10);
      if (Number.isInteger(days) && days > 0) {
        const cutoff = addDays(new Date(), days);
        filter.$or = [
          { status: "trialing", trialEndDate: { $lte: cutoff } },
          { status: { $in: ["active", "past_due"] }, nextBillingDate: { $lte: cutoff } },
        ];
      }
    }

    if (req.query.q) {
      const q = escapeRegex(String(req.query.q).trim());
      const schools = await School.find({
        $or: [
          { name: { $regex: q, $options: "i" } },
          { code: { $regex: q, $options: "i" } },
          { shortName: { $regex: q, $options: "i" } },
        ],
      })
        .select("_id")
        .lean();
      const ids = schools.map((s) => s._id);
      if (ids.length === 0) {
        return res.json({ success: true, count: 0, total: 0, page, pages: 0, data: [] });
      }
      filter.schoolId = { $in: ids };
    }

    const total = await Subscription.countDocuments(filter);
    const subs = await Subscription.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("schoolId", "_id name code shortName status")
      .populate("planId", "_id name code price currency billingCycle trialDays")
      .lean();
    res.json({
      success: true,
      count: subs.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
      data: subs.map(toSubscriptionJson),
    });
  } catch (err) {
    rawError(res, err);
  }
};

const getSubscription = async (req, res) => {
  try {
    const sub = await loadSubscription(req.params.id);
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found" });
    const invoices = await BillingInvoice.find({ subscriptionId: sub._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    const history = await Subscription.find({ schoolId: sub.schoolId._id || sub.schoolId })
      .sort({ createdAt: -1 })
      .limit(25)
      .populate("planId", "_id name code price currency billingCycle trialDays")
      .lean();
    res.json({
      success: true,
      data: {
        ...toSubscriptionJson(sub),
        invoices: invoices.map(toInvoiceJson),
        history: history.map(toSubscriptionJson),
      },
    });
  } catch (err) {
    rawError(res, err);
  }
};

const loadPlanOrThrow = async (planId) => {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const err = new Error("planId is invalid");
    err.status = 400;
    throw err;
  }
  const plan = await Plan.findById(planId);
  if (!plan) {
    const err = new Error("Plan not found");
    err.status = 404;
    throw err;
  }
  if (!plan.isActive) {
    const err = new Error("Inactive plans cannot be assigned");
    err.status = 409;
    throw err;
  }
  return plan;
};

const loadSchoolOrThrow = async (schoolId) => {
  if (!mongoose.Types.ObjectId.isValid(schoolId)) {
    const err = new Error("schoolId is invalid");
    err.status = 400;
    throw err;
  }
  const school = await School.findById(schoolId);
  if (!school) {
    const err = new Error("School not found");
    err.status = 404;
    throw err;
  }
  return school;
};

const createInvoiceForSubscription = async (sub, metadata = {}) => {
  if (!sub.price) return null;
  const invoiceNumber = generateInvoiceNumber();
  const durationPeriods = sub.durationPeriods || 1;
  const baseAmount = sub.price * durationPeriods;

  // GST @18% (CGST 9% + SGST 9%)
  const gstRate = 18;
  const gstAmount = Math.round(baseAmount * gstRate / 100);
  const cgstAmount = Math.round(gstAmount / 2);
  const sgstAmount = gstAmount - cgstAmount;
  const totalAmount = baseAmount + gstAmount;

  // Resolve plan and school snapshot data
  let planName = null, planCode = null, schoolName = null, schoolCode = null;
  try {
    if (sub.planId && typeof sub.planId === "object" && sub.planId.name) {
      planName = sub.planId.name;
      planCode = sub.planId.code;
    } else if (sub.planId) {
      const Plan = require("../models/Plan");
      const plan = await Plan.findById(sub.planId).select("name code").lean();
      if (plan) { planName = plan.name; planCode = plan.code; }
    }
    const School = require("../models/School");
    const school = await School.findById(sub.schoolId).select("name code").lean();
    if (school) { schoolName = school.name; schoolCode = school.code; }
  } catch (_) { /* best effort */ }

  const invoice = new BillingInvoice({
    invoiceNumber,
    schoolId: sub.schoolId,
    subscriptionId: sub._id,
    amount: baseAmount,
    currency: sub.currency,
    taxAmount: gstAmount,
    totalAmount,
    gstRate,
    cgstAmount,
    sgstAmount,
    status: "issued",
    periodStart: sub.currentPeriodStart || sub.startDate,
    periodEnd: sub.currentPeriodEnd || sub.nextBillingDate,
    dueDate: addDays(new Date(), 7),
    planName,
    planCode,
    durationPeriods,
    schoolName,
    schoolCode,
    paymentOrderId: metadata.paymentOrderId || null,
  });
  try {
    await invoice.save();
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return invoice;
};

const createSubscription = async (req, res) => {
  try {
    const { schoolId, planId, effectiveDate } = req.body || {};
    if (!schoolId || !planId) {
      return res.status(400).json({ success: false, message: "schoolId and planId are required" });
    }
    const school = await loadSchoolOrThrow(schoolId);
    const plan = await loadPlanOrThrow(planId);

    const dates = buildSubscriptionDates(plan, effectiveDate);

    // Close any existing current subscription BEFORE inserting (partial index
    // guarantees a school can never hold two current subscriptions).
    await closeCurrentSubscriptions(school._id, { reason: "assign-plan" });

    const sub = await Subscription.create({
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
    });
    await School.updateOne({ _id: school._id }, { $set: { plan: plan.code } });
    await createInvoiceForSubscription(sub);
    await writeAudit({ req, user: req.user, action: "subscription.created", targetType: "subscription", targetId: sub._id, message: `Assigned plan ${plan.code} to ${school.name}` });

    const loaded = await loadSubscription(sub._id);
    res.status(201).json({ success: true, message: "Subscription created", data: toSubscriptionJson(loaded) });
  } catch (err) {
    rawError(res, err);
  }
};

const updateSubscription = async (req, res) => {
  try {
    const { action } = req.body || {};
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found" });

    switch (action) {
      case "changePlan": {
        const plan = await loadPlanOrThrow(req.body.planId);
        const dates = buildSubscriptionDates(plan, req.body.effectiveDate);
        await closeCurrentSubscriptions(sub.schoolId, { reason: "plan-change" });
        const next = await Subscription.create({
          schoolId: sub.schoolId,
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
        });
        await School.updateOne({ _id: sub.schoolId }, { $set: { plan: plan.code } });
        await createInvoiceForSubscription(next);
        await writeAudit({ req, user: req.user, action: "subscription.changed", targetType: "subscription", targetId: next._id, message: `Changed subscription to plan ${plan.code}` });
        const loaded = await loadSubscription(next._id);
        return res.json({ success: true, message: "Plan changed", data: toSubscriptionJson(loaded) });
      }

      case "extendTrial": {
        if (sub.status !== "trialing") {
          return res.status(400).json({ success: false, message: "Only trialing subscriptions can be extended" });
        }
        const days = parseInt(req.body.days, 10);
        if (!Number.isInteger(days) || days <= 0) {
          return res.status(400).json({ success: false, message: "days must be a positive integer" });
        }
        const base = sub.trialEndDate && sub.trialEndDate > new Date() ? sub.trialEndDate : new Date();
        const newEnd = addDays(base, days);
        sub.trialEndDate = newEnd;
        sub.currentPeriodEnd = newEnd;
        sub.nextBillingDate = newEnd;
        await sub.save();
        await writeAudit({ req, user: req.user, action: "subscription.changed", targetType: "subscription", targetId: sub._id, message: `Extended trial by ${days} days` });
        const loaded = await loadSubscription(sub._id);
        return res.json({ success: true, message: "Trial extended", data: toSubscriptionJson(loaded) });
      }

      case "suspend": {
        if (!CURRENT_SUBSCRIPTION_STATUSES.includes(sub.status)) {
          return res.status(400).json({ success: false, message: "Subscription is not current" });
        }
        sub.status = "suspended";
        sub.suspendedAt = new Date();
        sub.nextBillingDate = null;
        await sub.save();
        await writeAudit({ req, user: req.user, action: "subscription.suspended", targetType: "subscription", targetId: sub._id, message: "Subscription suspended" });
        const loaded = await loadSubscription(sub._id);
        return res.json({ success: true, message: "Subscription suspended", data: toSubscriptionJson(loaded) });
      }

      case "reactivate": {
        if (["trialing", "active", "past_due"].includes(sub.status)) {
          return res.status(400).json({ success: false, message: "Subscription is already current" });
        }
        const plan = await Plan.findById(sub.planId);
        if (!plan || !plan.isActive) {
          return res.status(400).json({ success: false, message: "Linked plan is not active" });
        }
        const cycleMonths = sub.billingCycle === "yearly" ? 12 : 1;
        const now = new Date();
        sub.status = "active";
        sub.currentPeriodStart = now;
        sub.currentPeriodEnd = addMonths(now, cycleMonths);
        sub.nextBillingDate = sub.currentPeriodEnd;
        sub.suspendedAt = null;
        sub.cancelledAt = null;
        sub.endedAt = null;
        await sub.save();
        await writeAudit({ req, user: req.user, action: "subscription.reactivated", targetType: "subscription", targetId: sub._id, message: "Subscription reactivated" });
        const loaded = await loadSubscription(sub._id);
        return res.json({ success: true, message: "Subscription reactivated", data: toSubscriptionJson(loaded) });
      }

      case "cancel": {
        if (["cancelled", "expired"].includes(sub.status)) {
          return res.status(400).json({ success: false, message: "Subscription already ended" });
        }
        sub.status = "cancelled";
        sub.cancelledAt = new Date();
        sub.endedAt = new Date();
        sub.nextBillingDate = null;
        await sub.save();
        await writeAudit({ req, user: req.user, action: "subscription.cancelled", targetType: "subscription", targetId: sub._id, message: "Subscription cancelled" });
        const loaded = await loadSubscription(sub._id);
        return res.json({ success: true, message: "Subscription cancelled", data: toSubscriptionJson(loaded) });
      }

      default:
        return res.status(400).json({
          success: false,
          message: "action must be one of: changePlan, extendTrial, suspend, reactivate, cancel",
        });
    }
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Billing / invoice handlers
// --------------------------------------------------------------------------

const listInvoices = async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req);
    const filter = {};
    if (req.query.schoolId) filter.schoolId = asObjectId(req.query.schoolId, "schoolId");
    if (req.query.subscriptionId) filter.subscriptionId = asObjectId(req.query.subscriptionId, "subscriptionId");
    if (req.query.status) filter.status = req.query.status;

    const total = await BillingInvoice.countDocuments(filter);
    const invoices = await BillingInvoice.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("schoolId", "_id name code")
      .lean();
    res.json({
      success: true,
      count: invoices.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
      data: invoices.map(toInvoiceJson),
    });
  } catch (err) {
    rawError(res, err);
  }
};

const getInvoice = async (req, res) => {
  try {
    const invoice = await BillingInvoice.findById(req.params.id)
      .populate("schoolId", "_id name code")
      .lean();
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    res.json({ success: true, data: toInvoiceJson(invoice) });
  } catch (err) {
    rawError(res, err);
  }
};

const generateInvoice = async (req, res) => {
  try {
    const { subscriptionId, periodStart, periodEnd } = req.body || {};
    if (!subscriptionId) return res.status(400).json({ success: false, message: "subscriptionId is required" });
    const sub = await Subscription.findById(subscriptionId);
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found" });

    const invoice = await createInvoiceForSubscriptionWithPeriod(sub, periodStart, periodEnd);
    await writeAudit({ req, user: req.user, action: "invoice.generated", targetType: "invoice", targetId: invoice._id, message: `Generated invoice ${invoice.invoiceNumber}` });
    return res.status(201).json({ success: true, message: "Invoice generated", data: toInvoiceJson(invoice.toJSON ? invoice : invoice) });
  } catch (err) {
    rawError(res, err);
  }
};

const createInvoiceForSubscriptionWithPeriod = async (sub, periodStart, periodEnd) => {
  const invoiceNumber = generateInvoiceNumber();
  const durationPeriods = sub.durationPeriods || 1;
  const baseAmount = sub.price * durationPeriods;

  // GST @18% (CGST 9% + SGST 9%)
  const gstRate = 18;
  const gstAmount = Math.round(baseAmount * gstRate / 100);
  const cgstAmount = Math.round(gstAmount / 2);
  const sgstAmount = gstAmount - cgstAmount;
  const totalAmount = baseAmount + gstAmount;

  let planName = null, planCode = null, schoolName = null, schoolCode = null;
  try {
    if (sub.planId && typeof sub.planId === "object" && sub.planId.name) {
      planName = sub.planId.name;
      planCode = sub.planId.code;
    } else if (sub.planId) {
      const Plan = require("../models/Plan");
      const plan = await Plan.findById(sub.planId).select("name code").lean();
      if (plan) { planName = plan.name; planCode = plan.code; }
    }
    const School = require("../models/School");
    const school = await School.findById(sub.schoolId).select("name code").lean();
    if (school) { schoolName = school.name; schoolCode = school.code; }
  } catch (_) { /* best effort */ }

  const invoice = new BillingInvoice({
    invoiceNumber,
    schoolId: sub.schoolId,
    subscriptionId: sub._id,
    amount: baseAmount,
    currency: sub.currency,
    taxAmount: gstAmount,
    totalAmount,
    gstRate,
    cgstAmount,
    sgstAmount,
    status: "issued",
    periodStart: periodStart ? new Date(periodStart) : sub.currentPeriodStart || sub.startDate,
    periodEnd: periodEnd ? new Date(periodEnd) : sub.currentPeriodEnd || sub.nextBillingDate,
    dueDate: addDays(new Date(), 7),
    planName,
    planCode,
    durationPeriods,
    schoolName,
    schoolCode,
  });
  try {
    await invoice.save();
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return invoice;
};

const updateInvoice = async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = ["draft", "issued", "paid", "void", "overdue"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${allowed.join(", ")}` });
    }
    const invoice = await BillingInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    invoice.status = status;
    invoice.paidAt = status === "paid" ? new Date() : undefined;
    await invoice.save();
    await writeAudit({ req, user: req.user, action: "invoice.updated", targetType: "invoice", targetId: invoice._id, message: `Invoice ${invoice.invoiceNumber} → ${status}` });
    res.json({ success: true, message: "Invoice updated", data: toInvoiceJson(invoice.toJSON()) });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Platform analytics (Platform Owner dashboard KPIs)
// --------------------------------------------------------------------------

const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const buildMonthSeries = (count) => {
  const series = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    series.push({ month: monthKey(cursor), label: cursor.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }), count: 0 });
  }
  return series;
};

const getPlatformAnalytics = async (req, res) => {
  try {
    // Tenant footprint
    const [schools, activeSchools, users] = await Promise.all([
      School.countDocuments({}),
      School.countDocuments({ status: "active" }),
      User.countDocuments({ role: { $ne: "super_admin" }, deletedAt: null }),
    ]);

    // Subscription status distribution
    const statusRows = await Subscription.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]);
    const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.n]));

    // Current subscriptions -> MRR / ARPU + plan distribution + expiring soon
    const current = await Subscription.find({ status: { $in: CURRENT_SUBSCRIPTION_STATUSES } })
      .populate("schoolId", "_id name code status")
      .populate("planId", "_id name code")
      .lean();

    const currentTotal = current.length;
    const toMonthly = (sub) => (sub.billingCycle === "yearly" ? (sub.price || 0) / 12 : sub.price || 0);
    let mrr = 0;
    let payingCount = 0;
    for (const sub of current) {
      const monthly = toMonthly(sub);
      if (monthly > 0) {
        mrr += monthly;
        payingCount++;
      }
    }
    mrr = Math.round(mrr * 100) / 100;

    const planDistribution = {};
    for (const sub of current) {
      const code = sub.planId?.code || "unknown";
      planDistribution[code] = (planDistribution[code] || 0) + 1;
    }
    const distribution = Object.entries(planDistribution)
      .map(([plan, count]) => ({ plan, count }))
      .sort((a, b) => b.count - a.count);

    const now = new Date();
    const soonLimit = addDays(now, 14);

    const withReference = (sub) => {
      const reference = sub.status === "trialing" ? sub.trialEndDate || sub.nextBillingDate : sub.nextBillingDate;
      return { sub, reference: reference ? new Date(reference) : null };
    };

    const expiringSoon = current
      .map(withReference)
      .filter(({ reference }) => reference && reference <= soonLimit)
      .sort((a, b) => a.reference - b.reference)
      .slice(0, 5)
      .map(({ sub, reference }) => ({ ...toSubscriptionJson(sub), nextBillingDate: reference }));

    // Revenue from invoices
    const revenueRows = await BillingInvoice.aggregate([
      { $match: { status: { $ne: "void" } } },
      { $group: { _id: "$status", total: { $sum: "$amount" }, n: { $sum: 1 } } },
    ]);
    const revenueByStatus = Object.fromEntries(revenueRows.map((r) => [r._id, r]));
    const collected = revenueByStatus.paid?.total || 0;
    const outstanding = (revenueByStatus.issued?.total || 0) + (revenueByStatus.overdue?.total || 0);

    // School growth (last 12 months, by createdAt)
    const growthSeries = buildMonthSeries(12);
    const growthRows = await School.aggregate([
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, n: { $sum: 1 } } },
    ]);
    const growthMap = Object.fromEntries(growthRows.map((r) => [r._id, r.n]));
    for (const point of growthSeries) point.count = growthMap[point.month] || 0;

    // Subscription distribution buckets for charting
    const SUB_LABELS = { trialing: "Trialing", active: "Active", past_due: "Past due", suspended: "Suspended", cancelled: "Cancelled", expired: "Expired" };
    const subscriptionDistribution = Object.entries(SUB_LABELS).map(([status, label]) => ({ status, label, count: byStatus[status] || 0 }));

    // Expiring buckets: 7 / 15 / 30 days (pagination over the full sorted list)
    const expiringItems = current.map(withReference).filter(({ reference }) => reference).sort((a, b) => a.reference - b.reference);
    const expPage = Math.max(1, parseInt(req.query.expPage, 10) || 1);
    const expLimit = Math.min(100, Math.max(1, parseInt(req.query.expLimit, 10) || 10));
    const expSkip = (expPage - 1) * expLimit;
    const expiringSubscriptions = {
      in7: 0,
      in15: 0,
      in30: 0,
      total: expiringItems.length,
      page: expPage,
      pageSize: expLimit,
      items: expiringItems.slice(expSkip, expSkip + expLimit).map(({ sub, reference }) => ({ ...toSubscriptionJson(sub), reference })),
    };
    for (const it of expiringItems) {
      const days = Math.ceil((it.reference - now) / 86400000);
      if (days <= 30) expiringSubscriptions.in30++;
      if (days <= 15) expiringSubscriptions.in15++;
      if (days <= 7) expiringSubscriptions.in7++;
    }

    // Onboarding funnel
    const onboardingRows = await School.aggregate([{ $group: { _id: "$onboarding.status", n: { $sum: 1 } } }]);
    const onboardingMap = Object.fromEntries(onboardingRows.map((r) => [r._id, r.n]));
    const funnelSteps = ["created", "configured", "subscribed", "live"];
    const funnel = funnelSteps.map((step) => ({ step: step === "live" ? "live" : step, count: onboardingMap[step] || 0 }));

    // Recent activity from the audit trail (never exposes secrets)
    const actPage = Math.max(1, parseInt(req.query.actPage, 10) || 1);
    const actLimit = Math.min(100, Math.max(1, parseInt(req.query.actLimit, 10) || 8));
    const actSkip = (actPage - 1) * actLimit;
    const [activityTotal, recentActivity] = await Promise.all([
      AuditLog.countDocuments({}),
      AuditLog.find({})
        .sort({ createdAt: -1 })
        .skip(actSkip)
        .limit(actLimit)
        .select("actorId actorEmail actorRole action targetType targetId message result createdAt")
        .lean(),
    ]);

    // Alerts for the operator's attention
    const alerts = [];
    const expiring7 = expiringItems.filter(({ reference }) => reference <= addDays(now, 7));
    if (expiring7.length) alerts.push({ severity: "warning", type: "subscription_expiring", message: `${expiring7.length} subscription(s) expire within 7 days` });
    if ((revenueByStatus.overdue?.n || 0) > 0) {
      alerts.push({ severity: "warning", type: "invoices_overdue", message: `${revenueByStatus.overdue.n} invoice(s) overdue totalling ${(revenueByStatus.overdue.total || 0).toFixed(2)}` });
    }
    const noSubActive = await School.countDocuments({ status: "active", "_id": { $nin: current.map((c) => c.schoolId?._id || c.schoolId).filter(Boolean) } });
    if (noSubActive) alerts.push({ severity: "info", type: "schools_without_subscription", message: `${noSubActive} active school(s) have no current subscription` });

    res.json({
      success: true,
      data: {
        generatedAt: new Date(),
        // ---- structured dashboard contract ----
        overview: {
          schools: { total: schools, active: activeSchools },
          users: { total: users },
          subscriptions: {
            total: (byStatus.trialing || 0) + (byStatus.active || 0) + (byStatus.past_due || 0) + (byStatus.cancelled || 0) + (byStatus.expired || 0) + (byStatus.suspended || 0),
            current: currentTotal,
            byStatus,
          },
          mrr,
          arpu: payingCount ? Math.round((mrr / payingCount) * 100) / 100 : 0,
          payingSchools: payingCount,
          revenue: { collected, outstanding },
        },
        schoolGrowth: growthSeries,
        subscriptionDistribution,
        planDistribution: distribution,
        onboarding: { funnelMembers: Math.max(1, schools), funnel },
        expiringSubscriptions,
        revenue: {
          collected,
          outstanding,
          invoices: {
            paid: revenueByStatus.paid?.n || 0,
            issued: revenueByStatus.issued?.n || 0,
            overdue: revenueByStatus.overdue?.n || 0,
            draft: revenueByStatus.draft?.n || 0,
          },
        },
        recentActivity,
        recentActivityTotal: activityTotal,
        recentActivityPage: actPage,
        recentActivityPageSize: actLimit,
        alerts,
        // ---- legacy aliases (kept for backward compatibility) ----
        schools,
        activeSchools,
        users,
        subscriptions: {
          total:
            (byStatus.trialing || 0) +
            (byStatus.active || 0) +
            (byStatus.past_due || 0) +
            (byStatus.cancelled || 0) +
            (byStatus.expired || 0) +
            (byStatus.suspended || 0),
          current: currentTotal,
          trialing: byStatus.trialing || 0,
          active: byStatus.active || 0,
          past_due: byStatus.past_due || 0,
          suspended: byStatus.suspended || 0,
          cancelled: byStatus.cancelled || 0,
          expired: byStatus.expired || 0,
        },
        mrr,
        arpu: payingCount ? Math.round((mrr / payingCount) * 100) / 100 : 0,
        planDistribution: distribution,
        expiringSoon,
        revenue: {
          collected,
          outstanding,
          invoices: {
            paid: revenueByStatus.paid?.n || 0,
            issued: revenueByStatus.issued?.n || 0,
            overdue: revenueByStatus.overdue?.n || 0,
            draft: revenueByStatus.draft?.n || 0,
          },
        },
      },
    });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Audit log handler (append-oriented, read-only via API)
// --------------------------------------------------------------------------

const listAuditLogs = async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req, 25);
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.targetType) filter.targetType = req.query.targetType;
    if (req.query.actorEmail) filter.actorEmail = { $regex: escapeRegex(req.query.actorEmail), $options: "i" };
    if (req.query.result) filter.result = req.query.result;

    const total = await AuditLog.countDocuments(filter);
    const docs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json({ success: true, count: docs.length, total, page, pages: Math.ceil(total / limit) || 0, data: docs });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Platform user management (list / 360) — no mass assignment, no secrets
// --------------------------------------------------------------------------

const toPlatformUserJson = (raw) => ({
  _id: raw._id,
  name: raw.name,
  email: raw.email,
  role: raw.role,
  schoolId: raw.schoolId || null,
  designation: raw.designation || null,
  class: raw.class || null,
  section: raw.section || null,
  phone: raw.phone || null,
  isActive: raw.isActive !== false,
  emailVerified: raw.emailVerified !== false,
  deletedAt: raw.deletedAt || null,
  lastLogin: raw.lastLogin || null,
  lastActivity: raw.lastActivity || null,
  createdAt: raw.createdAt,
});

const listPlatformUsers = async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req, 25);
    const { q, role, schoolId, includeDeleted } = req.query;
    const filter = {};
    if (includeDeleted !== "true") filter.deletedAt = null;
    if (role) filter.role = role;
    if (schoolId) filter.schoolId = asObjectId(schoolId, "schoolId");
    if (q) {
      const rx = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [{ name: rx }, { email: rx }];
    }

    const total = await User.countDocuments(filter);
    const docs = await User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json({ success: true, count: docs.length, total, page, pages: Math.ceil(total / limit) || 0, data: docs.map(toPlatformUserJson) });
  } catch (err) {
    rawError(res, err);
  }
};

const getUser360 = async (req, res) => {
  try {
    const id = asObjectId(req.params.id, "id");
    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let school = null;
    if (user.schoolId) {
      school = await School.findById(user.schoolId).select("name code shortName city status plan").lean();
    }

    let subscription = null;
    if (user.schoolId) {
      const sub = await Subscription.findOne({ schoolId: user.schoolId, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } })
        .populate("planId", "_id name code price currency billingCycle trialDays")
        .sort({ createdAt: -1 })
        .lean();
      if (sub) subscription = toSubscriptionJson(sub);
    }

    const recentAudits = await AuditLog.find({ $or: [{ actorId: user._id }, { targetType: "user", targetId: user._id }] })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({ success: true, data: { user: toPlatformUserJson(user), school, subscription, recentAudits } });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// School management (list / 360 / lifecycle / onboarding)
// --------------------------------------------------------------------------

const toSchoolJson = (raw) => ({
  _id: raw._id,
  name: raw.name,
  code: raw.code,
  shortName: raw.shortName || null,
  email: raw.email || null,
  phone: raw.phone || null,
  address: raw.address || null,
  city: raw.city || null,
  state: raw.state || null,
  pincode: raw.pincode || null,
  session: raw.session || null,
  academicConfigConfirmed: Boolean(raw.academicConfigConfirmed),
  board: raw.board || null,
  recognitionNumber: raw.recognitionNumber || null,
  recognitionAuthority: raw.recognitionAuthority || null,
  recognitionVerified: Boolean(raw.recognitionVerified),
  recognitionVerifiedAt: raw.recognitionVerifiedAt || null,
  logo: raw.logo || null,
  website: raw.website || null,
  status: raw.status,
  plan: raw.plan,
  isDeleted: Boolean(raw.isDeleted),
  deletedAt: raw.deletedAt || null,
  deletedBy: raw.deletedBy || null,
  onboarding: raw.onboarding || { status: "created", appliedAt: null, completedAt: null },
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});

const listPlatformSchools = async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req, 25);
    const { q, status, plan, onboarding, deleted } = req.query;
    const filter = {};
    // By default exclude deleted schools; pass deleted=true to show only deleted
    if (deleted === "true") {
      filter.isDeleted = true;
    } else {
      filter.isDeleted = { $ne: true };
    }
    if (status) filter.status = status;
    if (plan) filter.plan = plan;
    if (onboarding) filter["onboarding.status"] = onboarding;
    if (q) {
      const rx = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [{ name: rx }, { code: rx }, { shortName: rx }, { city: rx }];
    }

    const total = await School.countDocuments(filter);
    const docs = await School.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json({ success: true, count: docs.length, total, page, pages: Math.ceil(total / limit) || 0, data: docs.map(toSchoolJson) });
  } catch (err) {
    rawError(res, err);
  }
};

const getSchool360 = async (req, res) => {
  try {
    const id = asObjectId(req.params.id, "id");
    const school = await School.findById(id).lean();
    if (!school) return res.status(404).json({ success: false, message: "School not found" });

    const [adminUsers, activeUsers, subscription, recentInvoices, currentSession] = await Promise.all([
      User.find({ schoolId: id, role: "school_admin", deletedAt: null }).select("name email lastLogin isActive").sort({ createdAt: -1 }).limit(5).lean(),
      User.countDocuments({ schoolId: id, role: { $ne: "super_admin" }, deletedAt: null }),
      Subscription.findOne({ schoolId: id, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } })
        .populate("planId", "_id name code price currency billingCycle trialDays")
        .sort({ createdAt: -1 })
        .lean(),
      BillingInvoice.find({ schoolId: id }).sort({ createdAt: -1 }).limit(5).lean(),
      AcademicSession.findOne({ schoolId: id, isCurrent: true }).select("name startDate endDate").lean(),
    ]);

    res.json({
      success: true,
      data: {
        school: toSchoolJson(school),
        admins: adminUsers,
        activeUsers,
        subscription: subscription ? toSubscriptionJson(subscription) : null,
        recentInvoices: recentInvoices.map(toInvoiceJson),
        currentSession,
      },
    });
  } catch (err) {
    rawError(res, err);
  }
};

const SCHOOL_PROFILE_FIELDS = ["name", "shortName", "email", "phone", "address", "city", "state", "pincode", "website", "logo", "board", "recognitionNumber", "recognitionAuthority", "recognitionVerified"];

const updateSchoolProfile = async (req, res) => {
  try {
    const patch = {};
    for (const key of SCHOOL_PROFILE_FIELDS) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    const school = await School.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!school) return res.status(404).json({ success: false, message: "School not found" });

    await writeAudit({
      req,
      user: req.user,
      action: "school.updated",
      targetType: "school",
      targetId: school._id,
      message: `School profile updated: ${Object.keys(patch).join(", ")}`,
    });

    res.json({ success: true, message: "School updated", data: toSchoolJson(school) });
  } catch (err) {
    rawError(res, err);
  }
};

const SCHOOL_LIFECYCLE = { active: "school.activated", suspended: "school.suspended" };

const updateSchoolStatus = async (req, res) => {
  try {
    const { status, reason } = req.body || {};
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be one of: active, suspended" });
    }
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });

    school.status = status;
    const reasonText = (reason || "").toString().trim();
    if (reasonText) school.settings = { ...(school.settings || {}), lastStatusReason: reasonText };
    await school.save();

    await writeAudit({
      req,
      user: req.user,
      action: SCHOOL_LIFECYCLE[status],
      targetType: "school",
      targetId: school._id,
      message: `School ${school.name} ${status === "active" ? "activated" : "suspended"}`,
      reason: reasonText || null,
    });
    res.json({ success: true, message: `School ${status === "active" ? "activated" : "suspended"}`, data: toSchoolJson(school) });
  } catch (err) {
    rawError(res, err);
  }
};

const softDeleteSchool = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });
    if (school.isDeleted) return res.status(400).json({ success: false, message: "School is already deleted" });

    school.isDeleted = true;
    school.deletedAt = new Date();
    school.deletedBy = req.user?.email || "platform";
    if (!["trial", "basic", "standard", "premium"].includes(school.plan)) {
      school.plan = "trial";
    }
    const reasonText = (reason || "").toString().trim();
    if (reasonText) school.settings = { ...(school.settings || {}), lastDeleteReason: reasonText };
    await school.save();

    await writeAudit({
      req, user: req.user,
      action: "school.soft_deleted",
      targetType: "school", targetId: school._id,
      message: `School ${school.name} soft deleted`,
      reason: reasonText || null,
    });
    res.json({ success: true, message: "School moved to trash", data: toSchoolJson(school) });
  } catch (err) {
    rawError(res, err);
  }
};

const restoreSchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });
    if (!school.isDeleted) return res.status(400).json({ success: false, message: "School is not deleted" });

    school.isDeleted = false;
    school.deletedAt = null;
    school.deletedBy = null;
    await school.save();

    await writeAudit({
      req, user: req.user,
      action: "school.restored",
      targetType: "school", targetId: school._id,
      message: `School ${school.name} restored from trash`,
    });
    res.json({ success: true, message: "School restored", data: toSchoolJson(school) });
  } catch (err) {
    rawError(res, err);
  }
};

const hardDeleteSchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });

    await writeAudit({
      req, user: req.user,
      action: "school.hard_deleted",
      targetType: "school", targetId: school._id,
      message: `School ${school.name} permanently deleted`,
    });

    await School.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "School permanently deleted" });
  } catch (err) {
    rawError(res, err);
  }
};

const ONBOARDING_FLOW = ["created", "configured", "subscribed", "live"];
const nextOnboardingStep = (from, to) => {
  const i = ONBOARDING_FLOW.indexOf(from);
  const j = ONBOARDING_FLOW.indexOf(to);
  return j >= 0 && (i === -1 || j > i);
};

const updateSchoolOnboarding = async (req, res) => {
  try {
    const { status, notes } = req.body || {};
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });

    const current = school.onboarding?.status || "created";
    if (!nextOnboardingStep(current, status)) {
      return res.status(400).json({ success: false, message: `Cannot move onboarding from ${current} to ${status}. Flow: ${ONBOARDING_FLOW.join(" → ")}` });
    }

    school.onboarding = {
      status,
      appliedAt: school.onboarding?.appliedAt || new Date(),
      completedAt: status === "live" ? new Date() : school.onboarding?.completedAt || null,
      notes: notes !== undefined ? String(notes).trim() : school.onboarding?.notes || "",
    };
    await school.save();

    await writeAudit({
      req,
      user: req.user,
      action: "school.updated",
      targetType: "school",
      targetId: school._id,
      message: `Onboarding advanced ${current} → ${status}`,
    });
    res.json({ success: true, message: "Onboarding updated", data: toSchoolJson(school) });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Welcome email to school admin after launch
// --------------------------------------------------------------------------

const sendSchoolWelcomeEmail = async (req, res) => {
  try {
    const id = asObjectId(req.params.id, "id");
    const school = await School.findById(id).lean();
    if (!school) return res.status(404).json({ success: false, message: "School not found" });

    const admin = await User.findOne({ schoolId: id, role: "school_admin", deletedAt: null })
      .select("name email")
      .lean();
    if (!admin) return res.status(404).json({ success: false, message: "School admin not found" });

    const subscription = await Subscription.findOne({ schoolId: id, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } })
      .populate("planId", "_id name code price billingCycle trialDays")
      .sort({ createdAt: -1 })
      .lean();

    const plan = subscription?.planId;
    const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/login`;

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#16213E;">
        <div style="background:#16213E;padding:28px 32px;border-radius:12px 12px 0 0;">
          <h1 style="color:#E8A33D;font-size:20px;margin:0;">Zipschool OS</h1>
          <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:4px 0 0;">School Onboarding Complete</p>
        </div>
        <div style="background:#fff;padding:28px 32px;border:1px solid rgba(0,0,0,0.06);border-top:none;border-radius:0 0 12px 12px;">
          <p style="font-size:14px;margin:0 0 16px;">Hi <strong>${admin.name}</strong>,</p>
          <p style="font-size:13px;color:#475467;margin:0 0 20px;">
            Your school <strong>${school.name}</strong> has been successfully onboarded on Zipschool OS.
            Below are your login credentials and school details.
          </p>

          <div style="background:#F8F6F1;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
            <h3 style="font-size:13px;color:#475467;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.5px;">School Details</h3>
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
              <tr><td style="padding:4px 0;color:#475467;">School Name</td><td style="padding:4px 0;font-weight:600;text-align:right;">${school.name}</td></tr>
              <tr><td style="padding:4px 0;color:#475467;">School Code</td><td style="padding:4px 0;font-family:monospace;font-weight:600;text-align:right;">${school.code}</td></tr>
              ${school.city ? `<tr><td style="padding:4px 0;color:#475467;">City</td><td style="padding:4px 0;text-align:right;">${school.city}</td></tr>` : ""}
              ${school.session ? `<tr><td style="padding:4px 0;color:#475467;">Session</td><td style="padding:4px 0;text-align:right;">${school.session}</td></tr>` : ""}
            </table>
          </div>

          <div style="background:#F8F6F1;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
            <h3 style="font-size:13px;color:#475467;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.5px;">Admin Credentials</h3>
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
              <tr><td style="padding:4px 0;color:#475467;">Name</td><td style="padding:4px 0;font-weight:600;text-align:right;">${admin.name}</td></tr>
              <tr><td style="padding:4px 0;color:#475467;">Email</td><td style="padding:4px 0;text-align:right;">${admin.email}</td></tr>
              <tr><td style="padding:4px 0;color:#475467;">Login URL</td><td style="padding:4px 0;text-align:right;"><a href="${loginUrl}" style="color:#3B6FA0;">${loginUrl}</a></td></tr>
            </table>
          </div>

          ${plan ? `
          <div style="background:#F8F6F1;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
            <h3 style="font-size:13px;color:#475467;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.5px;">Subscription</h3>
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
              <tr><td style="padding:4px 0;color:#475467;">Plan</td><td style="padding:4px 0;font-weight:600;text-align:right;">${plan.name}</td></tr>
              <tr><td style="padding:4px 0;color:#475467;">Price</td><td style="padding:4px 0;font-weight:600;text-align:right;">₹${Number(plan.price || 0).toLocaleString("en-IN")}/${plan.billingCycle === "yearly" ? "yr" : "mo"}</td></tr>
              ${plan.trialDays ? `<tr><td style="padding:4px 0;color:#475467;">Trial</td><td style="padding:4px 0;text-align:right;">${plan.trialDays} days</td></tr>` : ""}
            </table>
          </div>
          ` : ""}

          <div style="text-align:center;margin:24px 0 8px;">
            <a href="${loginUrl}" style="display:inline-block;background:#E8A33D;color:#16213E;font-weight:700;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;">Login to Dashboard</a>
          </div>

          <p style="font-size:11px;color:#475467;text-align:center;margin-top:20px;">
            This email was sent by Zipschool OS · Powered by AI Knots IT Solution
          </p>
        </div>
      </div>
    `;

    await sendEmail({
      to: admin.email,
      subject: `Welcome to Zipschool OS — ${school.name} is Live!`,
      html,
    });

    await writeAudit({
      req,
      user: req.user,
      action: "school.welcome_email_sent",
      targetType: "school",
      targetId: school._id,
      message: `Welcome email sent to ${admin.email} for ${school.name}`,
    });

    res.json({ success: true, message: "Welcome email sent" });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Reports (live, generated on demand from real platform data)
// --------------------------------------------------------------------------

const REPORT_CATALOG = [
  {
    id: "tenant-directory",
    title: "Tenant directory",
    category: "Schools",
    description: "Every tenant school with status, plan, onboarding stage and active-user count.",
  },
  {
    id: "user-roster",
    title: "User roster",
    category: "Users & Access",
    description: "All platform users (excluding platform owner) with role, school, status and login activity.",
  },
  {
    id: "subscription-ledger",
    title: "Subscription ledger",
    category: "Billing",
    description: "Every subscription across all schools with plan, price snapshot and key billing dates.",
  },
  {
    id: "invoice-ledger",
    title: "Invoice ledger",
    category: "Billing",
    description: "All generated invoices with amount, status and payment dates.",
  },
  {
    id: "revenue-summary",
    title: "Revenue summary",
    category: "Billing",
    description: "MRR, ARPU, collected vs outstanding and invoice counts at this moment.",
  },
];

const buildDaysAgo = (days) => new Date(new Date().getTime() - days * 24 * 60 * 60 * 1000);

const applyDateWindow = (req, filter, dateField = "createdAt") => {
  if (req.query.from || req.query.to) {
    filter[dateField] = {};
    if (req.query.from) filter[dateField].$gte = new Date(req.query.from);
    if (req.query.to) filter[dateField].$lte = new Date(req.query.to);
  }
  return filter;
};

const reportGenerators = {
  "tenant-directory": async (req) => {
    const filter = applyDateWindow(req, {});
    if (req.query.status) filter.status = req.query.status;
    const schools = await School.find(filter).sort({ createdAt: -1 }).lean();
    const userCounts = await User.aggregate([
      { $match: { deletedAt: null, schoolId: { $ne: null } } },
      { $group: { _id: "$schoolId", users: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(userCounts.map((r) => [String(r._id), r.users]));
    return schools.map((school) => ({
      school: school.name,
      code: school.code,
      status: school.status,
      plan: school.plan,
      onboarding: school.onboarding?.status || "created",
      city: school.city || null,
      activeUsers: countMap[String(school._id)] || 0,
      createdAt: school.createdAt,
    }));
  },

  "user-roster": async (req) => {
    const filter = applyDateWindow(req, { role: { $ne: "super_admin" } });
    if (req.query.role) filter.role = req.query.role;
    if (req.query.includeDeleted === "true") delete filter.deletedAt;
    else filter.deletedAt = null;
    const users = await User.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    const schoolIds = [...new Set(users.map((u) => u.schoolId).filter(Boolean))];
    const schools = await School.find({ _id: { $in: schoolIds } }).select("name code").lean();
    const schoolMap = Object.fromEntries(schools.map((s) => [String(s._id), s.name]));
    return users.map((user) => ({
      name: user.name,
      email: user.email,
      role: user.role,
      school: user.schoolId ? schoolMap[String(user.schoolId)] || null : null,
      status: user.deletedAt ? "removed" : user.isActive ? "active" : "inactive",
      lastLogin: user.lastLogin || null,
      lastActivity: user.lastActivity || null,
      createdAt: user.createdAt,
    }));
  },

  "subscription-ledger": async (req) => {
    const filter = applyDateWindow(req);
    if (req.query.status) filter.status = req.query.status;
    const subs = await Subscription.find(filter)
      .sort({ createdAt: -1 })
      .limit(2000)
      .populate("schoolId", "name code")
      .populate("planId", "name code")
      .lean();
    return subs.map((sub) => ({
      school: sub.schoolId?.name || null,
      code: sub.schoolId?.code || null,
      plan: sub.planId?.name || null,
      planCode: sub.planId?.code || null,
      status: sub.status,
      price: sub.price,
      currency: sub.currency,
      cycle: sub.billingCycle,
      start: sub.startDate,
      trialEnd: sub.trialEndDate || null,
      nextBilling: sub.nextBillingDate || null,
      createdAt: sub.createdAt,
    }));
  },

  "invoice-ledger": async (req) => {
    const filter = applyDateWindow(req);
    if (req.query.status) filter.status = req.query.status;
    const invoices = await BillingInvoice.find(filter)
      .sort({ createdAt: -1 })
      .limit(2000)
      .populate("schoolId", "name code")
      .lean();
    return invoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      school: inv.schoolId?.name || null,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      periodStart: inv.periodStart || null,
      periodEnd: inv.periodEnd || null,
      dueDate: inv.dueDate || null,
      paidAt: inv.paidAt || null,
      createdAt: inv.createdAt,
    }));
  },

  "revenue-summary": async () => {
    const [current, revenueRows] = await Promise.all([
      Subscription.find({ status: { $in: CURRENT_SUBSCRIPTION_STATUSES } }).lean(),
      BillingInvoice.aggregate([
        { $match: { status: { $ne: "void" } } },
        { $group: { _id: "$status", total: { $sum: "$amount" }, n: { $sum: 1 } } },
      ]),
    ]);
    const revenueByStatus = Object.fromEntries(revenueRows.map((r) => [r._id, r]));
    let mrr = 0;
    let payingCount = 0;
    for (const sub of current) {
      const monthly = sub.billingCycle === "yearly" ? (sub.price || 0) / 12 : sub.price || 0;
      if (monthly > 0) {
        mrr += monthly;
        payingCount++;
      }
    }
    mrr = Math.round(mrr * 100) / 100;
    const collected = revenueByStatus.paid?.total || 0;
    const outstanding = (revenueByStatus.issued?.total || 0) + (revenueByStatus.overdue?.total || 0);
    return {
      metric: [
        { metric: "Current subscriptions", value: String(current.length) },
        { metric: "MRR (₹)", value: mrr.toFixed(2) },
        { metric: "ARPU per paying school (₹/mo)", value: payingCount ? (mrr / payingCount).toFixed(2) : "0.00" },
        { metric: "Collected (₹)", value: collected.toFixed(2) },
        { metric: "Outstanding (₹)", value: outstanding.toFixed(2) },
        { metric: "Paid invoices", value: String(revenueByStatus.paid?.n || 0) },
        { metric: "Issued invoices", value: String(revenueByStatus.issued?.n || 0) },
        { metric: "Overdue invoices", value: String(revenueByStatus.overdue?.n || 0) },
        { metric: "Draft invoices", value: String(revenueByStatus.draft?.n || 0) },
      ],
    };
  },
};

const listReports = async (req, res) => {
  try {
    res.json({ success: true, data: REPORT_CATALOG });
  } catch (err) {
    rawError(res, err);
  }
};

const generateReport = async (req, res) => {
  try {
    const { type } = req.params;
    const definition = REPORT_CATALOG.find((r) => r.id === type);
    const generator = reportGenerators[type];
    if (!definition || !generator) {
      return res.status(404).json({ success: false, message: "Unknown report type" });
    }
    const rows = await generator(req);
    const wrapped = rows && rows.metric ? rows.metric : rows;
    await writeAudit({
      req,
      user: req.user,
      action: "report.generated",
      targetType: "report",
      message: `Generated report: ${type}`,
      result: "success",
    });
    res.json({
      success: true,
      data: {
        meta: { type: definition.id, title: definition.title, generatedAt: new Date(), rowCount: wrapped.length },
        columns: Object.keys(wrapped[0] || {}),
        rows: wrapped,
      },
    });
  } catch (err) {
    rawError(res, err);
  }
};

// --------------------------------------------------------------------------
// Platform Settings (secrets-free; only whitelisted keys, change-driven)
// --------------------------------------------------------------------------

const SETTING_DEFS = {
  "platform.name": { label: "Platform name", section: "general", type: "string", help: "Display name shown across the platform.", default: "Zipschool OS" },
  "support.email": { label: "Support email", section: "general", type: "string", help: "Public support contact shown on signup and help pages.", default: "support@example.com" },
  "security.sessionTimeoutMinutes": { label: "Session timeout (minutes)", section: "security", type: "number", min: 5, max: 1440, help: "Idle time before access tokens are considered stale.", default: 120 },
  "security.requireEmailVerification": { label: "Require email verification", section: "security", type: "boolean", help: "Block logins until a user verifies their email address.", default: true },
  "billing.defaultCurrency": { label: "Default currency", section: "billing", type: "string", options: ["INR", "USD", "EUR"], help: "Currency used for new subscriptions and invoices.", default: "INR" },
  "billing.overdueGraceDays": { label: "Overdue grace (days)", section: "billing", type: "number", min: 0, max: 365, help: "Days after an invoice is due before it is flagged overdue.", default: 7 },
  "notifications.renewalReminderDays": { label: "Renewal reminder (days before)", section: "notifications", type: "number", min: 0, max: 120, help: "How far in advance renewal reminders are sent to schools.", default: 7 },
};

const coerceSettingValue = (def, value) => {
  if (def.type === "boolean") return Boolean(value);
  if (def.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw Object.assign(new Error(`Invalid number for setting`), { status: 400 });
    if (def.min !== undefined && n < def.min) throw Object.assign(new Error(`Value must be >= ${def.min}`), { status: 400 });
    if (def.max !== undefined && n > def.max) throw Object.assign(new Error(`Value must be <= ${def.max}`), { status: 400 });
    return n;
  }
  if (def.options && !def.options.includes(value)) {
    throw Object.assign(new Error(`Invalid value, expected one of: ${def.options.join(", ")}`), { status: 400 });
  }
  return String(value);
};

const getPlatformSettings = async (req, res) => {
  try {
    const stored = await PlatformSetting.find().lean();
    const map = Object.fromEntries(stored.map((s) => [s.key, s]));
    const data = Object.entries(SETTING_DEFS).map(([key, def]) => ({
      key,
      label: def.label,
      section: def.section,
      type: def.type,
      value: key in map ? map[key].value : def.default,
      default: def.default,
      min: def.min,
      max: def.max,
      options: def.options,
      help: def.help,
      updatedAt: map[key]?.updatedAt || null,
    }));
    res.json({ success: true, data });
  } catch (err) {
    rawError(res, err);
  }
};

const updatePlatformSettings = async (req, res) => {
  try {
    const body = req.body || {};
    const allowed = Object.keys(SETTING_DEFS);
    const entries = Object.entries(body);
    if (entries.length === 0) {
      return res.status(400).json({ success: false, message: "No settings provided" });
    }
    const coerced = [];
    for (const [key, raw] of entries) {
      const def = SETTING_DEFS[key];
      if (!def) {
        const err = new Error(`Key is not editable: ${key}`);
        err.status = 400;
        throw err;
      }
      coerced.push([key, coerceSettingValue(def, raw)]);
    }
    for (const [key, value] of coerced) {
      await PlatformSetting.findOneAndUpdate(
        { key },
        { key, value, updatedBy: req.user?.email || null },
        { upsert: true, new: true }
      );
    }
    await writeAudit({
      req,
      user: req.user,
      action: "settings.changed",
      targetType: "setting",
      message: `Updated platform setting(s): ${coerced.map(([k]) => k).join(", ")}`,
      result: "success",
    });
    const stored = await PlatformSetting.find().lean();
    const map = Object.fromEntries(stored.map((s) => [s.key, s]));
    const data = Object.entries(SETTING_DEFS).map(([key, def]) => ({
      key,
      label: def.label,
      section: def.section,
      type: def.type,
      value: key in map ? map[key].value : def.default,
      default: def.default,
      min: def.min,
      max: def.max,
      options: def.options,
      help: def.help,
      updatedAt: map[key]?.updatedAt || null,
    }));
    res.json({ success: true, data });
  } catch (err) {
    rawError(res, err);
  }
};

// ---------------------------------------------------------------------------
// Reference data (boards, cities, states, recognition authorities)
// ---------------------------------------------------------------------------
const VALID_CATEGORIES = ["board", "recognition_authority", "city", "state"];

const listReferenceData = async (req, res) => {
  try {
    const { category } = req.params;
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    const ReferenceData = require("../models/ReferenceData");
    const items = await ReferenceData.find({ category }).sort({ value: 1 }).lean();
    res.json({ success: true, data: items.map((i) => i.value) });
  } catch (err) {
    rawError(res, err);
  }
};

const addReferenceData = async (req, res) => {
  try {
    const { category } = req.params;
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    const value = String(req.body.value || "").trim();
    if (!value) {
      return res.status(400).json({ success: false, message: "Value is required" });
    }
    const ReferenceData = require("../models/ReferenceData");
    let doc;
    try {
      doc = await ReferenceData.findOneAndUpdate(
        { category, value },
        { $setOnInsert: { category, value } },
        { upsert: true, new: true, runValidators: true },
      );
    } catch (err) {
      if (err.code === 11000) {
        doc = await ReferenceData.findOne({ category, value }).lean();
      } else {
        throw err;
      }
    }
    res.status(201).json({ success: true, data: doc.value });
  } catch (err) {
    rawError(res, err);
  }
};

module.exports = {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  listSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  listInvoices,
  getInvoice,
  generateInvoice,
  updateInvoice,
  getPlatformAnalytics,
  listReports,
  generateReport,
  getPlatformSettings,
  updatePlatformSettings,
  listAuditLogs,
  listPlatformUsers,
  getUser360,
  listPlatformSchools,
  getSchool360,
  updateSchoolStatus,
  softDeleteSchool,
  restoreSchool,
  hardDeleteSchool,
  updateSchoolOnboarding,
  updateSchoolProfile,
  sendSchoolWelcomeEmail,
  listReferenceData,
  addReferenceData,
  formatMoney,
  // shared helpers reused by tenantController (school self-service).
  toSubscriptionJson,
  toInvoiceJson,
  buildSubscriptionDates,
  closeCurrentSubscriptions,
  createInvoiceForSubscription,
  loadSubscription,
  loadPlanOrThrow,
  rawError,
};
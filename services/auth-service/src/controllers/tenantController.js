const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const { CURRENT_SUBSCRIPTION_STATUSES, SCHEDULED_STATUSES } = require("../models/Subscription");
const School = require("../models/School");
const User = require("../models/User");
const BillingInvoice = require("../models/BillingInvoice");
const { writeAudit } = require("../utils/audit");
const { generateInvoicePdf } = require("../utils/invoicePdf");
const {
  toSubscriptionJson,
  toInvoiceJson,
  buildSubscriptionDates,
  closeCurrentSubscriptions,
  createInvoiceForSubscription,
  loadSubscription,
  loadPlanOrThrow,
  rawError,
} = require("./platformController");

// --------------------------------------------------------------------------
// School-facing subscription self-service. A school admin can inspect their
// own plan, compare public plans and upgrade instantly. All lookups are
// scoped to req.tenantId (from the JWT) — a school can never touch another
// tenant's billing data.
// --------------------------------------------------------------------------

const getMySubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({
      schoolId: req.tenantId,
      status: { $in: CURRENT_SUBSCRIPTION_STATUSES },
    })
      .sort({ createdAt: -1 })
      .populate("planId", "_id name code price currency billingCycle trialDays")
      .lean();
    res.json({ success: true, data: sub ? toSubscriptionJson(sub) : null });
  } catch (err) {
    rawError(res, err);
  }
};

const getMyScheduledSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({
      schoolId: req.tenantId,
      status: "scheduled",
    })
      .sort({ createdAt: -1 })
      .populate("planId", "_id name code price currency billingCycle trialDays")
      .lean();
    res.json({ success: true, data: sub ? toSubscriptionJson(sub) : null });
  } catch (err) {
    rawError(res, err);
  }
};

const listPublicPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true, isPublic: true })
      .sort({ sortOrder: 1, price: 1 })
      .lean();
    res.json({ success: true, count: plans.length, data: plans });
  } catch (err) {
    rawError(res, err);
  }
};

// Live usage vs plan limits. Counts platform user accounts inside this school
// (the same measure the tenant's plan limits are expressed against).
const getMyUsage = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId, deletedAt: null };
    const [students, teachers, staff, adminUsers, total] = await Promise.all([
      User.countDocuments({ ...filter, role: "student" }),
      User.countDocuments({ ...filter, role: "teacher" }),
      User.countDocuments({ ...filter, role: "staff" }),
      User.countDocuments({ ...filter, role: "school_admin" }),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, data: { students, teachers, staff, adminUsers, total } });
  } catch (err) {
    rawError(res, err);
  }
};

const upgradeMyPlan = async (req, res) => {
  try {
    const schoolId = req.tenantId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: "No school attached to this account" });
    }
    const { planId, durationPeriods: rawDuration, switchMode: rawSwitchMode } = req.body || {};
    if (!planId) {
      return res.status(400).json({ success: false, message: "planId is required" });
    }

    // durationPeriods: 1–99, default 1. Backend-owned.
    const durationPeriods = Math.max(1, Math.min(99, Math.floor(Number(rawDuration) || 1)));

    // switchMode: "immediate" or "advance". Default "immediate".
    const switchMode = ["immediate", "advance"].includes(rawSwitchMode) ? rawSwitchMode : "immediate";

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: "School not found" });
    }
    if (school.status !== "active") {
      return res.status(409).json({ success: false, message: "School is not active — contact the platform owner" });
    }

    const plan = await loadPlanOrThrow(planId);
    if (!plan.isPublic) {
      return res.status(409).json({ success: false, message: "This plan is not available for self-service upgrade" });
    }

    // Find current active/trialing subscription
    const current = await Subscription.findOne({ schoolId, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } })
      .sort({ createdAt: -1 })
      .populate("planId", "_id code name")
      .lean();

    // Same plan check
    if (current && String(current.planId?._id || current.planId) === String(plan._id)) {
      const loaded = await loadSubscription(current._id);
      return res.json({ success: true, message: "Already subscribed to this plan", data: toSubscriptionJson(loaded) });
    }

    // ── One active + one scheduled rule ──
    const existingScheduled = await Subscription.findOne({ schoolId, status: "scheduled" }).lean();
    if (existingScheduled) {
      return res.status(409).json({
        success: false,
        message: "You already have a scheduled plan upgrade. Cancel or replace it before purchasing a new one.",
        data: { scheduledSubscriptionId: existingScheduled._id },
      });
    }

    // ── Server-authoritative startDate ──
    let serverStartDate;
    if (switchMode === "advance") {
      if (!current || !current.currentPeriodEnd) {
        return res.status(400).json({ success: false, message: "No active subscription to schedule after" });
      }
      serverStartDate = new Date(current.currentPeriodEnd);
      // Ensure startDate is in the future
      if (serverStartDate <= new Date()) {
        serverStartDate = new Date();
        serverStartDate.setDate(serverStartDate.getDate() + 1);
      }
    } else {
      serverStartDate = new Date();
    }

    // Backend-calculated amount: plan.price × durationPeriods
    const totalAmount = plan.price * durationPeriods;

    // ── Free / trial plans switch instantly (no payment) ──
    if (totalAmount <= 0) {
      if (current) {
        await closeCurrentSubscriptions(schoolId, { reason: "self-upgrade-free" });
      }
      const dates = buildSubscriptionDates(plan, serverStartDate, durationPeriods);
      const next = await Subscription.create({
        schoolId,
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
        durationPeriods,
      });
      await School.updateOne({ _id: schoolId }, { $set: { plan: plan.code } });
      const invoice = await createInvoiceForSubscription(next);
      if (invoice) {
        invoice.status = "paid";
        invoice.paidAt = new Date();
        await invoice.save();
      }
      await writeAudit({ req, user: req.user, action: "subscription.changed", targetType: "subscription", targetId: next._id, message: `School upgraded to plan ${plan.code}` });
      const loaded = await loadSubscription(next._id);
      return res.status(201).json({ success: true, message: "Plan upgraded", data: toSubscriptionJson(loaded) });
    }

    // ── Paid plans: create payment order FIRST, old subscription untouched ──
    const feeUrl = process.env.FEE_SERVICE_URL || "http://localhost:5005";
    const resOrder = await fetch(`${feeUrl}/api/payments/internal/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": process.env.INTERNAL_NOTIFY_KEY || "",
      },
      body: JSON.stringify({
        schoolId,
        planId: plan._id,
        amount: totalAmount,
        currency: plan.currency,
        durationPeriods,
        switchMode,
        startDate: serverStartDate.toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await resOrder.json().catch(() => ({}));
    if (!resOrder.ok || !json.success) {
      return res.status(503).json({
        success: false,
        message: "Payment engine unavailable — please try again shortly",
      });
    }
    return res.json({ success: true, data: { requiresPayment: true, ...json.data } });
  } catch (err) {
    rawError(res, err);
  }
};

// ── Invoice Endpoints (school-scoped) ──────────────────────────────────

const listMyInvoices = async (req, res) => {
  try {
    const schoolId = req.tenantId;
    if (!schoolId) return res.status(400).json({ success: false, message: "No school attached" });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { schoolId };
    if (req.query.status) {
      const allowed = ["draft", "issued", "paid", "void", "overdue"];
      if (allowed.includes(req.query.status)) filter.status = req.query.status;
    }
    if (req.query.search) {
      // Escaped: raw search text could carry regex meta-characters (ReDoS).
      const term = String(req.query.search)
        .trim()
        .slice(0, 100)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(term, "i");
      filter.$or = [
        { invoiceNumber: regex },
        { planName: regex },
        { planCode: regex },
      ];
    }

    const [invoices, total] = await Promise.all([
      BillingInvoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      BillingInvoice.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        invoices: invoices.map(toInvoiceJson),
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    rawError(res, err);
  }
};

const getMyInvoice = async (req, res) => {
  try {
    const schoolId = req.tenantId;
    const { id } = req.params;
    if (!schoolId) return res.status(400).json({ success: false, message: "No school attached" });

    const invoice = await BillingInvoice.findOne({ _id: id, schoolId })
      .populate("subscriptionId", "planId billingCycle durationPeriods")
      .lean();
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    res.json({ success: true, data: toInvoiceJson(invoice) });
  } catch (err) {
    rawError(res, err);
  }
};

const downloadMyInvoicePdf = async (req, res) => {
  try {
    const schoolId = req.tenantId;
    const { id } = req.params;
    if (!schoolId) return res.status(400).json({ success: false, message: "No school attached" });

    const invoice = await BillingInvoice.findOne({ _id: id, schoolId }).lean();
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    if (!["paid", "issued"].includes(invoice.status)) {
      return res.status(400).json({ success: false, message: "PDF only available for paid/issued invoices" });
    }

    const pdfBuffer = await generateInvoicePdf(invoice);
    const filename = `${invoice.invoiceNumber || "invoice"}.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    rawError(res, err);
  }
};

module.exports = {
  getMySubscription,
  getMyScheduledSubscription,
  listPublicPlans,
  getMyUsage,
  upgradeMyPlan,
  listMyInvoices,
  getMyInvoice,
  downloadMyInvoicePdf,
};
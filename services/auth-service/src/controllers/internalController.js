// Service-to-service endpoints (fee-service payment engine -> auth-service).
// Not reachable through the public gateway; guarded by the shared internal key
// (INTERNAL_NOTIFY_KEY, same convention as the communication/student services).
const crypto = require("node:crypto");
const School = require("../models/School");
const User = require("../models/User");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const { CURRENT_SUBSCRIPTION_STATUSES, SCHEDULED_STATUSES } = require("../models/Subscription");
const PaymentGateway = require("../models/PaymentGateway");
const { decryptSecret } = require("../utils/gatewayCrypto");
const {
  toSubscriptionJson,
  buildSubscriptionDates,
  closeCurrentSubscriptions,
  createInvoiceForSubscription,
  loadSubscription,
  loadPlanOrThrow,
} = require("./platformController");

const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;
const keyUsable = () => Boolean(INTERNAL_KEY && INTERNAL_KEY.length >= 32);

// Constant-time header compare; fail closed (401) when the key is unset.
const internalGuard = (req, res, next) => {
  if (!keyUsable()) {
    return res.status(401).json({ success: false, message: "Internal key is not configured" });
  }
  const presented = req.headers["x-internal-key"];
  if (!presented) {
    return res.status(401).json({ success: false, message: "Missing internal key" });
  }
  const expectedHex = Buffer.from(String(INTERNAL_KEY), "utf8").toString("hex");
  const presentedHex = Buffer.from(String(presented), "utf8").toString("hex");
  const valid =
    expectedHex.length === presentedHex.length &&
    crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(presentedHex));
  if (!valid) {
    return res.status(401).json({ success: false, message: "Invalid internal key" });
  }
  next();
};

const resolveSchool = async (req) => {
  const { schoolId } = req.query;
  if (schoolId) return schoolId;
  const { schoolCode } = req.query;
  if (schoolCode) {
    const school = await School.findOne({ code: String(schoolCode).toLowerCase() }).select("_id").lean();
    return school?._id || null;
  }
  return null;
};

// Fully decrypted gateway config for the payment engine (internal only).
const getPaymentGateway = async (req, res) => {
  try {
    const schoolId = await resolveSchool(req);
    if (!schoolId) {
      return res.status(400).json({ success: false, message: "schoolId or schoolCode is required" });
    }
    const gw = await PaymentGateway.findOne({ schoolId }).lean();
    if (!gw) return res.json({ success: true, data: null });

    const p = gw.providers || {};
    const data = {
      schoolId: gw.schoolId,
      mode: gw.mode,
      status: gw.status,
      display: gw.display || {},
      providers: {
        razorpay: p.razorpay
          ? {
              keyId: p.razorpay.keyId,
              keySecret: decryptSecret(p.razorpay.keySecret),
              webhookSecret: decryptSecret(p.razorpay.webhookSecret),
              testMode: p.razorpay.testMode,
            }
          : undefined,
        stripe: p.stripe
          ? {
              publishableKey: p.stripe.publishableKey,
              secretKey: decryptSecret(p.stripe.secretKey),
              webhookSecret: decryptSecret(p.stripe.webhookSecret),
              testMode: p.stripe.testMode,
            }
          : undefined,
        phonepe: p.phonepe
          ? {
              merchantId: p.phonepe.merchantId,
              saltKey: decryptSecret(p.phonepe.saltKey),
              saltIndex: p.phonepe.saltIndex,
              env: p.phonepe.env,
            }
          : undefined,
      },
    };
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Called by the payment engine when a subscription_upgrade order is fully paid.
// Idempotent: if the school is already on the target plan, it's a no-op.
const subscriptionPaid = async (req, res) => {
  try {
    const { schoolId, planId, amount, currency, orderId, providerOrderId, durationPeriods: rawDur, switchMode: rawSwitchMode, startDate: rawStartDate } = req.body || {};
    if (!schoolId || !planId) {
      return res.status(400).json({ success: false, message: "schoolId and planId are required" });
    }

    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ success: false, message: "School not found" });
    if (school.status !== "active") {
      return res.status(409).json({ success: false, message: "School is not active" });
    }

    const plan = await loadPlanOrThrow(planId);
    const durationPeriods = Math.max(1, Math.min(99, Math.floor(Number(rawDur) || 1)));
    const switchMode = ["immediate", "advance"].includes(rawSwitchMode) ? rawSwitchMode : "immediate";

    const expectedAmount = plan.price * durationPeriods;
    if (Number(expectedAmount) !== Number(amount)) {
      return res.status(400).json({ success: false, message: "Paid amount does not match expected amount" });
    }

    // Current active/trialing subscription
    const current = await Subscription.findOne({ schoolId, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } })
      .sort({ createdAt: -1 })
      .populate("planId", "_id code")
      .lean();

    // Same plan idempotency
    if (current && String(current.planId?._id || current.planId) === String(plan._id)) {
      return res.json({ success: true, data: { already: true } });
    }

    // Server-authoritative startDate (from order metadata, set by tenantController)
    let serverStartDate = rawStartDate ? new Date(rawStartDate) : new Date();

    if (switchMode === "advance") {
      // ── ADVANCE: keep current active, create scheduled subscription ──
      const dates = buildSubscriptionDates(plan, serverStartDate, durationPeriods);
      const next = await Subscription.create({
        schoolId,
        planId: plan._id,
        status: "scheduled",
        startDate: dates.startDate,
        trialStartDate: dates.trialStartDate,
        trialEndDate: dates.trialEndDate,
        currentPeriodStart: dates.currentPeriodStart,
        currentPeriodEnd: dates.currentPeriodEnd,
        nextBillingDate: dates.nextBillingDate,
        billingCycle: plan.billingCycle,
        price: plan.price,
        currency: plan.currency || currency,
        durationPeriods,
        metadata: { paymentOrderId: orderId || null, providerOrderId: providerOrderId || null, switchMode: "advance" },
      });
      const invoice = await createInvoiceForSubscription(next, { paymentOrderId: orderId || null });
      if (invoice) {
        invoice.status = "paid";
        invoice.paidAt = new Date();
        await invoice.save();
      }
      const loaded = await loadSubscription(next._id);
      return res.json({ success: true, data: { ...toSubscriptionJson(loaded), scheduledActivation: serverStartDate.toISOString() } });
    }

    // ── IMMEDIATE: cancel old subscription, create new active subscription ──
    await closeCurrentSubscriptions(schoolId, { reason: `payment:${orderId || providerOrderId || "manual"}` });

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
      currency: plan.currency || currency,
      durationPeriods,
      metadata: { paymentOrderId: orderId || null, providerOrderId: providerOrderId || null, switchMode: "immediate" },
    });
    await School.updateOne({ _id: schoolId }, { $set: { plan: plan.code } });
    const invoice = await createInvoiceForSubscription(next, { paymentOrderId: orderId || null });
    if (invoice) {
      invoice.status = "paid";
      invoice.paidAt = new Date();
      await invoice.save();
    }

    const loaded = await loadSubscription(next._id);
    res.json({ success: true, data: toSubscriptionJson(loaded) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------------------------------------
// Student delete-cascade hooks (called by student-service, Phase 2). Both
// match on role="student" + refId=admissionNo within the same school so they
// can never touch another role's account.
// ---------------------------------------------------------------------------

// Soft-delete of a Student row → deactivate the linked login (reversible via
// the normal user activation flow; the account simply stops authenticating).
const deactivateStudentUser = async (req, res) => {
  try {
    const { schoolId, admissionNo } = req.body || {};
    if (!schoolId || !admissionNo) {
      return res.status(400).json({ success: false, message: "schoolId and admissionNo are required" });
    }
    const result = await User.updateOne(
      { schoolId, refId: String(admissionNo), role: "student", deletedAt: null },
      { $set: { isActive: false } },
    );
    res.json({ success: true, data: { matched: result.matchedCount, modified: result.modifiedCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Final purge of a soft-deleted student → remove the linked login entirely.
const purgeStudentUser = async (req, res) => {
  try {
    const { schoolId, admissionNo } = req.body || {};
    if (!schoolId || !admissionNo) {
      return res.status(400).json({ success: false, message: "schoolId and admissionNo are required" });
    }
    const result = await User.deleteOne({ schoolId, refId: String(admissionNo), role: "student" });
    res.json({ success: true, data: { deleted: result.deletedCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [INTERNAL] Transactional email relay (fee-service fee reminders, etc.).
// The SMTP transport lives here so nodemailer + credentials stay in one place;
// callers are other services holding the shared internal key.
const sendInternalEmail = async (req, res) => {
  try {
    const { to, subject, html } = req.body || {};
    const list = (Array.isArray(to) ? to : [to])
      .filter((e) => typeof e === "string" && e.includes("@"))
      .slice(0, 20);
    if (list.length === 0 || !subject || !html) {
      return res.status(400).json({ success: false, message: "to, subject and html are required" });
    }
    const { sendEmail } = require("../utils/email");
    const results = await Promise.allSettled(
      list.map((recipient) =>
        sendEmail({
          to: recipient,
          subject: String(subject).slice(0, 200),
          html: String(html).slice(0, 10000),
        }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === results.length) {
      return res.status(502).json({ success: false, message: "Email transport failed" });
    }
    res.json({ success: true, data: { sent: results.length - failed, failed } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { internalGuard, getPaymentGateway, subscriptionPaid, deactivateStudentUser, purgeStudentUser, sendInternalEmail };
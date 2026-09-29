const mongoose = require("mongoose");

// Paths that must stay reachable without an active subscription so a school
// can renew/upgrade (or the platform can manage billing). Matched against
// req.originalUrl (includes /api/... prefix from the gateway).
const SUBSCRIPTION_EXEMPT_PATHS = [
  "/api/payments/orders",
  "/api/webhooks",
  "/api/auth/school/me/subscription",
  "/api/auth/internal/subscription-paid",
];

const isExemptPath = (url = "") => {
  const path = url.split("?")[0];
  return SUBSCRIPTION_EXEMPT_PATHS.some((p) => path.startsWith(p));
};

/**
 * Middleware that blocks school_admin access when the school has no active
 * subscription. Must run AFTER resolveTenant + requireSchoolActive.
 *
 * Only enforced for school-scoped roles (school_admin, teacher, staff, student).
 * super_admin is never blocked.
 *
 * Caches subscription on req.schoolSubscription for downstream handlers.
 */
const requireSubscriptionActive = async (req, res, next) => {
  if (!req.tenantId) {
    return res.status(400).json({ success: false, message: "No school context for this request" });
  }

  // Super admin bypasses subscription checks
  if (req.user && req.user.role === "super_admin") {
    return next();
  }

  // Billing/renewal endpoints must work even when the subscription has lapsed.
  if (isExemptPath(req.originalUrl || req.url)) {
    return next();
  }

  try {
    const SubscriptionModel = mongoose.models.Subscription;
    if (!SubscriptionModel) {
      // Subscription model not registered in this microservice — allow through
      return next();
    }

    const CURRENT_STATUSES = ["trialing", "active", "past_due"];

    const subscription = await SubscriptionModel.findOne({
      schoolId: req.tenantId,
      status: { $in: CURRENT_STATUSES },
    })
      .select({ status: 1, planId: 1, trialEndDate: 1, currentPeriodEnd: 1, nextBillingDate: 1 })
      .sort({ createdAt: -1 })
      .lean();

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: "No active subscription found. Please renew your plan to continue.",
        code: "NO_ACTIVE_SUBSCRIPTION",
      });
    }

    // Check trial expiry
    if (subscription.status === "trialing" && subscription.trialEndDate) {
      if (new Date(subscription.trialEndDate) <= new Date()) {
        return res.status(403).json({
          success: false,
          message: "Your trial has expired. Please upgrade to a paid plan.",
          code: "TRIAL_EXPIRED",
        });
      }
    }

    // Check period end for active subscriptions
    if (subscription.status === "active" && subscription.currentPeriodEnd) {
      if (new Date(subscription.currentPeriodEnd) <= new Date()) {
        return res.status(403).json({
          success: false,
          message: "Your subscription has expired. Please renew to continue.",
          code: "SUBSCRIPTION_EXPIRED",
        });
      }
    }

    req.schoolSubscription = subscription;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireSubscriptionActive };

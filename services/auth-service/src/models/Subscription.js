const mongoose = require("mongoose");

// A school's SaaS subscription. Price/currency/billingCycle are SNAPSHOTS taken
// at creation so later plan price edits never rewrite historical billing data.
//
// Statuses split into two groups:
//   current   = ["trialing", "active", "past_due"]  -> at most ONE per school
//   terminal  = ["cancelled", "expired", "suspended"]
//
// The partial unique index below enforces the single-current-subscription rule
// at the database level (guard against concurrent create/plan-change requests).
const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "scheduled",
  "past_due",
  "cancelled",
  "expired",
  "suspended",
];
const CURRENT_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due"];
const SCHEDULED_STATUSES = ["scheduled"];

const subscriptionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: "active", index: true },
    startDate: { type: Date, required: true },
    trialStartDate: { type: Date },
    trialEndDate: { type: Date },
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    nextBillingDate: { type: Date },
    cancelledAt: { type: Date },
    suspendedAt: { type: Date },
    endedAt: { type: Date },
    billingCycle: { type: String, enum: ["monthly", "yearly"], required: true, default: "monthly" },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR", uppercase: true, trim: true },
    paymentProvider: { type: String, default: "manual" },
    externalSubscriptionId: { type: String },
    durationPeriods: { type: Number, min: 1, max: 99, default: 1 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// One and only one current subscription per school.
subscriptionSchema.index(
  { schoolId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: CURRENT_SUBSCRIPTION_STATUSES } },
  }
);
subscriptionSchema.index({ schoolId: 1, createdAt: -1 });
subscriptionSchema.index({ planId: 1 });
subscriptionSchema.index({ status: 1, nextBillingDate: 1 });

module.exports = mongoose.model("Subscription", subscriptionSchema);
module.exports.SUBSCRIPTION_STATUSES = SUBSCRIPTION_STATUSES;
module.exports.CURRENT_SUBSCRIPTION_STATUSES = CURRENT_SUBSCRIPTION_STATUSES;
module.exports.SCHEDULED_STATUSES = SCHEDULED_STATUSES;
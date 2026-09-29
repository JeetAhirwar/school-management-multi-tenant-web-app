const mongoose = require("mongoose");

// SaaS subscription plan. Convention: feature limits use `null` = unlimited.
// Money is stored as a plain integer-count rupee value (consistent with the
// existing fee-service convention); currency is stored on the plan for clarity.
const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, trim: true, default: "" },
    price: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, default: "INR", uppercase: true, trim: true },
    billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
    trialDays: { type: Number, min: 0, default: 0 },
    features: { type: [String], default: [] },
    limits: {
      students: { type: Number, default: null },
      staff: { type: Number, default: null },
      teachers: { type: Number, default: null },
      adminUsers: { type: Number, default: null },
      branches: { type: Number, default: null },
      storageGB: { type: Number, default: null },
    },
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

planSchema.index({ code: 1 }, { unique: true });
planSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("Plan", planSchema);
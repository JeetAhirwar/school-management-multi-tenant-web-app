const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    shortName: { type: String, trim: true },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },
    phone: { type: String },
    email: { type: String, lowercase: true, trim: true },
    logo: { type: String },
    website: { type: String, trim: true },
    domain: { type: String, lowercase: true, trim: true },
    // Affiliation & Recognition
    board: { type: String, trim: true },
    recognitionNumber: { type: String, trim: true },
    recognitionAuthority: { type: String, trim: true },
    recognitionVerified: { type: Boolean, default: false },
    recognitionVerifiedAt: { type: Date },
    session: { type: String },
    // Set true the first time the school admin explicitly creates or edits the
    // current academic session (Org Profile → Academic Configuration / Academic
    // Sessions). The onboarding auto-created session keeps this false so the
    // admin is prompted to verify the school-year calendar once.
    academicConfigConfirmed: { type: Boolean, default: false },
    plan: {
      type: String,
      enum: ["trial", "basic", "standard", "premium"],
      default: "trial",
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
    onboarding: {
      status: {
        type: String,
        enum: ["created", "configured", "subscribed", "live"],
        default: "created",
      },
      appliedAt: { type: Date },
      completedAt: { type: Date },
      notes: { type: String },
    },
    settings: {
      default: {},
      type: Object,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("School", schoolSchema);
const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
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
    onboarding: {
      status: {
        type: String,
        enum: ["created", "configured", "subscribed", "live"],
        default: "created",
      },
    },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.models.School || mongoose.model("School", schoolSchema);

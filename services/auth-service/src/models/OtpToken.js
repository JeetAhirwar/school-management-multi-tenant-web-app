const mongoose = require("mongoose");

const otpTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    otp: { type: String, required: true },
    purpose: {
      type: String,
      enum: ["password-reset"],
      default: "password-reset",
    },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

otpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpTokenSchema.index({ email: 1, purpose: 1, used: 1 });
otpTokenSchema.index({ userId: 1, purpose: 1, used: 1 });

module.exports = mongoose.model("OtpToken", otpTokenSchema);

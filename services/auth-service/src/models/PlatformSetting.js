const mongoose = require("mongoose");

// Platform-level configuration overrides. Only known keys (whitelisted in the
// controller) may be written. This store never holds environment secrets
// (JWT secret, DB URIs, provider keys) — those stay out of the API entirely.
const platformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformSetting", platformSettingSchema);
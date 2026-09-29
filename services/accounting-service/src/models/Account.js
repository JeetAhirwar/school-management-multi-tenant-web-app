const mongoose = require("mongoose");

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];

const accountSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    // System accounts (the seeded CoA) cannot be deleted or renamed.
    isSystem: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Codes are unique per tenant ("1000" for school A and school B coexist).
accountSchema.index({ schoolId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("Account", accountSchema);

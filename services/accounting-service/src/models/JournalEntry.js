const mongoose = require("mongoose");
const { validateEntryLines } = require("../utils/ledger");

const journalLineSchema = new mongoose.Schema(
  {
    accountCode: { type: String, required: true, trim: true, uppercase: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    date: { type: Date, default: Date.now, required: true },
    memo: { type: String, trim: true, maxlength: 500 },
    source: { type: String, enum: ["manual", "fee", "payroll", "system"], default: "manual" },
    refType: { type: String, trim: true },
    refId: { type: String, trim: true },
    // Idempotency key: the sweeper upserts by key so a re-scan can never
    // double-post. Manual entries carry no key.
    idemKey: { type: String, trim: true },
    lines: {
      type: [journalLineSchema],
      required: true,
      validate: {
        validator: (lines) => validateEntryLines(lines).ok,
        message: (props) =>
          validateEntryLines(props.value).error || "Entry lines are invalid",
      },
    },
    createdBy: { type: String },
    status: { type: String, enum: ["Posted", "Void"], default: "Posted" },
  },
  { timestamps: true }
);

journalEntrySchema.index({ schoolId: 1, date: -1 });
journalEntrySchema.index({ schoolId: 1, source: 1, date: -1 });
// Sweeper idempotency: one entry per (tenant, key). Manual entries have no
// key so they stay unindexed (partial filter on non-empty strings).
journalEntrySchema.index(
  { schoolId: 1, idemKey: 1 },
  { unique: true, partialFilterExpression: { idemKey: { $type: "string", $gt: "" } } }
);

module.exports = mongoose.model("JournalEntry", journalEntrySchema);

const mongoose = require("mongoose");

// Fee concessions — sibling discounts, scholarships and manual grants
// (CLIENT-REQ-045/046/047). Lifecycle: created as "Requested", an accountant
// or school admin approves it to "Active" (or rejects it). Only Active rows
// are applied at invoice-generation time; the invoice stores the computed
// concession amount, so later edits/deletes never rewrite money already
// billed.
const concessionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true }, // admissionNo
    kind: { type: String, enum: ["Sibling", "Scholarship", "Manual"], required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["percent", "flat"], required: true },
    value: { type: Number, required: true, min: 0 },
    session: { type: String, required: true },
    // Empty / absent = applies to every fee type in the session.
    feeType: { type: String, default: "" },
    status: { type: String, enum: ["Requested", "Active", "Rejected"], default: "Requested" },
    siblingOf: { type: String, default: null }, // Sibling: elder sibling admissionNo
    notes: { type: String, default: "" },
    requestedBy: { type: String },
    approvedBy: { type: String },
    approvedAt: { type: Date },
    rejectedBy: { type: String },
    rejectedReason: { type: String },
  },
  { timestamps: true }
);

// Lookup path for the generation-time netting query (dupes are enforced in
// the controller so a Rejected row does not block a re-request).
concessionSchema.index({ schoolId: 1, studentId: 1, session: 1, status: 1 });

module.exports = mongoose.model("Concession", concessionSchema);

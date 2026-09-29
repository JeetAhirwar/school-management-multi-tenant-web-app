const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    employeeId: { type: String, required: true },
    userId: { type: String, default: null },
    name: { type: String, required: true },
    designation: { type: String, required: true }, // Principal, PGT Physics, TGT Maths, etc.
    department: { type: String },
    role: { type: String, enum: ["teacher", "admin-staff", "support"], default: "teacher" },
    subjects: [{ type: String }],
    classesAssigned: [{ class: String, section: String }],
    qualification: { type: String },
    joiningDate: { type: Date, default: Date.now },
    contact: { type: String },
    email: { type: String },
    address: { type: String },
    photoUrl: { type: String },
    dob: { type: Date },
    gender: { type: String, enum: ["Male", "Female", "Other"] },
    salary: { type: Number, default: 0 },
    status: { type: String, enum: ["Active", "Inactive", "Resigned"], default: "Active" },
    // Onboarding state: derived server-side from the profile-completion rule.
    profileStatus: {
      type: String,
      enum: ["incomplete", "complete"],
      default: "incomplete",
    },
    profileCompletedAt: { type: Date, default: null },
    // Physical/printable staff ID card (same pattern as the student card).
    idCardNumber: { type: String, default: null },
    idCardIssuedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

staffSchema.index({ schoolId: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model("Staff", staffSchema);

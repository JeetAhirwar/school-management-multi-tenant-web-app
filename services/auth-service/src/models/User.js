const mongoose = require("mongoose");

const STAFF_DESIGNATIONS = [
  "admission_counsellor",
  "accountant",
  "librarian",
  "receptionist",
  "transport",
];

const userSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      // "teacher" is the login role for ALL teaching staff. Class Teacher is
      // NOT a User role: it is a TeacherAssignment(type="class_teacher")
      // responsibility layered on a teacher for a class/section/session.
      enum: ["super_admin", "school_admin", "teacher", "staff", "student", "parent"],
      required: true,
    },
    designation: {
      type: String,
      enum: STAFF_DESIGNATIONS,
      default: null,
    },
    class: { type: String, default: null },
    section: { type: String, default: null },
    phone: { type: String },
    avatar: { type: String, default: null },
    refId: { type: String, default: null },
    linkedStudentIds: [{ type: String }],
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    lastActivity: { type: Date },
    emailVerified: { type: Boolean, default: true },
    passwordChangedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index({ schoolId: 1, role: 1 });
userSchema.index({ isActive: 1, deletedAt: 1, createdAt: -1 });
userSchema.index({ deletedAt: 1, createdAt: -1 });
userSchema.index({ role: 1, deletedAt: 1 });

module.exports = mongoose.model("User", userSchema);
module.exports.STAFF_DESIGNATIONS = STAFF_DESIGNATIONS;
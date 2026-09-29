const mongoose = require("mongoose");

// The academic-service owns marks/attendance/homework; the authoritative
// student record (who belongs to which school/class/section) lives in the
// student-service database (erp_student). So that class-teachers cannot
// fabricate attendance/marks for arbitrary studentIds, this module opens a
// *second, lazy* mongoose connection to the student database and hosts a
// minimal mirror of the canonical Student model (collection "students").
//
// It is only ever loaded inside guarded write paths, so read-only flows carry
// zero extra connect cost. The student-service model remains the source of
// truth for domain reads/writes; this mirror only reads enrollment facts.
//
// NOTE: academic-service and auth-service both load Student mirrors. They
// share a schema shape but are independent module instances/connections.

const studentSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    admissionNo: { type: String, required: true },
    userId: { type: String, default: null },
    name: { type: String, required: true },
    dob: { type: Date },
    gender: { type: String, enum: ["Male", "Female", "Other"] },
    class: { type: String },
    section: { type: String },
    rollNo: { type: String },
    bloodGroup: { type: String },
    address: { type: String },
    photoUrl: { type: String },
    parentName: { type: String },
    parentContact: { type: String },
    parentEmail: { type: String },
    motherName: { type: String },
    house: { type: String },
    admissionDate: { type: Date, default: Date.now },
    feeCategory: { type: String, default: "Regular" },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Alumni", "Transferred"],
      default: "Active",
    },
    profileStatus: {
      type: String,
      enum: ["incomplete", "complete"],
      default: "incomplete",
    },
    profileCompletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "students" },
);

studentSchema.index({ schoolId: 1, admissionNo: 1 }, { unique: true });

let studentModel = null;

// Lazily builds and connects the mirror model. The first guarded write pays the
// connect cost; every later call reuses the same model.
async function getStudentModel() {
  if (studentModel) return studentModel;
  if (!process.env.STUDENT_MONGODB_URI) {
    const err = new Error("STUDENT_MONGODB_URI is not configured");
    throw err;
  }
  const connection = mongoose.createConnection(process.env.STUDENT_MONGODB_URI, {
    serverSelectionTimeoutMS: 4000,
    bufferCommands: false,
  });
  await connection.asPromise();
  studentModel = connection.model("Student", studentSchema);
  return studentModel;
}

module.exports = { getStudentModel };
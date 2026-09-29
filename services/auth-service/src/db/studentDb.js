const mongoose = require("mongoose");

// The platform (auth-service) owns the login account; the student record lives
// in student-service's database (erp_student). So that "create Student user
// with Admission ID" can reliably enforce
// `PlatformUser.refId === Student.admissionNo` within a school, this module
// opens a *second, lazy* mongoose connection to the student database and hosts
// a minimal mirror of the canonical Student model (collection "students").
//
// It is only ever loaded inside the student-role branch of user creation /
// editing, so non-student flows carry zero extra DB/connect cost. The schema
// deliberately mirrors the fields the student-service model understands; the
// student-service model remains the source of truth for domain reads/writes.
//
// IMPORTANT: The mirror schema keeps class/section optional so a
// platform-created draft shell can exist until an Admission Counsellor
// completes it.

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

const state = {};
let studentModel = null;

// Lazily builds and connects the mirror model. The first student-role request
// pays the connect cost; every later request reuses the same model.
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
  connection.on("error", (err) => {
    state.error = err.message;
  });
  await connection.asPromise();
  studentModel = connection.model("Student", studentSchema);
  return studentModel;
}

module.exports = { getStudentModel };
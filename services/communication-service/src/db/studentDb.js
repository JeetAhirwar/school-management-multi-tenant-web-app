const mongoose = require("mongoose");

// Read-only mirror of the canonical Student record (student-service DB,
// collection "students"). communication-service needs enrollment facts for
// class-tagged notice targeting: which admissionNos belong to a class/section,
// which class-section a student is in, and parent contact details for
// broadcasts. Same pattern as the academic-service mirror; lazy + guarded so
// flows that never touch class targeting carry zero connect cost.

const studentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    admissionNo: { type: String, required: true },
    userId: { type: String, default: null },
    name: { type: String, required: true },
    class: { type: String },
    section: { type: String },
    parentName: { type: String },
    parentContact: { type: String },
    parentEmail: { type: String },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Alumni", "Transferred"],
      default: "Active",
    },
  },
  { timestamps: true, collection: "students" },
);

studentSchema.index({ schoolId: 1, admissionNo: 1 }, { unique: true });

let studentModel = null;

async function getStudentModel() {
  if (studentModel) return studentModel;
  if (!process.env.STUDENT_MONGODB_URI) {
    throw new Error("STUDENT_MONGODB_URI is not configured");
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

const mongoose = require("mongoose");

// Read-only mirror of staff-service records (staff DB) so communication can
// resolve "who is the class teacher of 5-A" and "which classes does this
// teacher teach" without an HTTP hop. TeacherAssignment + Staff share the
// staff database, so one lazy connection hosts both models.

const teacherAssignmentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true, index: true },
    staffName: { type: String, trim: true, default: "" },
    session: { type: String, required: true, trim: true },
    type: { type: String, enum: ["teaching", "class_teacher"], required: true },
    subject: { type: String, trim: true, default: null },
    class: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
    status: { type: String, enum: ["active", "ended"], default: "active" },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "teacherassignments" },
);

const staffSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    employeeId: { type: String },
    userId: { type: String, default: null },
    name: { type: String, required: true },
    designation: { type: String },
    role: { type: String, enum: ["teacher", "admin-staff", "support"] },
    contact: { type: String, default: null },
    email: { type: String, default: null },
    status: { type: String, enum: ["Active", "Inactive", "Resigned"] },
  },
  { timestamps: true, collection: "staffs" },
);

let models = null;

async function getStaffModels() {
  if (models) return models;
  if (!process.env.STAFF_MONGODB_URI) {
    throw new Error("STAFF_MONGODB_URI is not configured");
  }
  const connection = mongoose.createConnection(process.env.STAFF_MONGODB_URI, {
    serverSelectionTimeoutMS: 4000,
    bufferCommands: false,
  });
  await connection.asPromise();
  models = {
    TeacherAssignment: connection.model("TeacherAssignment", teacherAssignmentSchema),
    Staff: connection.model("Staff", staffSchema),
  };
  return models;
}

module.exports = { getStaffModels };

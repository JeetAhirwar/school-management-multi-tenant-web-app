const mongoose = require("mongoose");

// The platform (auth-service) owns the login account; the staff/teacher record
// lives in staff-service's database (erp_staff). So that "create Teacher/Staff
// user with a manual Staff ID" can reliably enforce
// `user.refId === the linked Staff record` within a school, this module opens
// a *second, lazy* mongoose connection to the staff database and hosts a
// minimal mirror of the canonical Staff model (collection "staff").
//
// It is only ever loaded inside the staff/teacher/class-teacher branch of user
// creation / editing, so other flows carry zero extra DB/connect cost. The
// schema deliberately mirrors the fields the staff-service model understands;
// the staff-service model remains the source of truth for domain reads/writes.
//
// Register User must link an EXISTING Teacher/Staff record (created from the
// Teachers & Staff page) — it never fabricates one here.

const staffSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    employeeId: { type: String, required: true },
    userId: { type: String, default: null },
    name: { type: String, required: true },
    designation: { type: String, required: true },
    role: { type: String, enum: ["teacher", "admin-staff", "support"], default: "teacher" },
    classesAssigned: [{ class: String, section: String }],
    profileStatus: {
      type: String,
      enum: ["incomplete", "complete"],
      default: "incomplete",
    },
    profileCompletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "staffs" },
);

staffSchema.index({ schoolId: 1, employeeId: 1 }, { unique: true });

const state = {};
let staffModel = null;

// Lazily builds and connects the mirror model. The first staff/teacher-role
// request pays the connect cost; every later request reuses the same model.
async function getStaffModel() {
  if (staffModel) return staffModel;
  if (!process.env.STAFF_MONGODB_URI) {
    const err = new Error("STAFF_MONGODB_URI is not configured");
    throw err;
  }
  const connection = mongoose.createConnection(process.env.STAFF_MONGODB_URI, {
    serverSelectionTimeoutMS: 4000,
    bufferCommands: false,
  });
  connection.on("error", (err) => {
    state.error = err.message;
  });
  await connection.asPromise();
  staffModel = connection.model("Staff", staffSchema);
  return staffModel;
}

module.exports = { getStaffModel };
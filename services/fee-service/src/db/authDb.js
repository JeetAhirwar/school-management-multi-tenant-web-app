const mongoose = require("mongoose");

// Read-only cross-DB mirror of the auth-service User collection (collection
// "users"), opened lazily the same way as db/studentDb.js. The fee-service
// needs it to resolve which logins (student + linked parents) should receive
// fee reminders for a given invoice's studentId; it never writes.
const userSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    role: { type: String },
    refId: { type: String, default: null },
    linkedStudentIds: [{ type: String }],
    isActive: { type: Boolean, default: true },
    name: { type: String },
    email: { type: String },
  },
  { timestamps: true, collection: "users" },
);

userSchema.index({ schoolId: 1, role: 1 });
userSchema.index({ schoolId: 1, refId: 1 });

let userModel = null;

async function getUserModel() {
  if (userModel) return userModel;
  if (!process.env.AUTH_MONGODB_URI) {
    throw new Error("AUTH_MONGODB_URI is not configured");
  }
  const connection = mongoose.createConnection(process.env.AUTH_MONGODB_URI, {
    serverSelectionTimeoutMS: 4000,
    bufferCommands: false,
  });
  await connection.asPromise();
  userModel = connection.model("User", userSchema);
  return userModel;
}

module.exports = { getUserModel };

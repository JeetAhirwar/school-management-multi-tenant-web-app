// Minimal user reference (bound to the auth database) used to resolve
// notification recipients by school + role. Never stores credentials.
const mongoose = require("mongoose");
const { getAuthDb } = require("../db/authDb");

const userSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, index: true },
    refId: { type: String, index: true },
    role: { type: String, index: true },
    designation: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    // parent accounts carry their linked children (admissionNos) in the JWT;
    // mirrored here so class-tagged fan-out and broadcast can reach parents
    // (parents have refId === null, so refId-only resolvers can never find them).
    linkedStudentIds: [{ type: String }],
    email: { type: String, default: null },
  },
  { strict: true }
);

let User = null;

function getUserModel() {
  if (!User) {
    const db = getAuthDb();
    User = db.model("User", userSchema, "users");
  }
  return User;
}

module.exports = { getUserModel };
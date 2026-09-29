// Platform Super Admin bootstrap — creates the ONLY initial platform user:
//
//   Name     : Aiknotsit Admin
//   Email    : administrator@aiknotsit.com
//   Role     : super_admin   (platform-scoped: schoolId === null)
//   Active   : true
//   Password : bcrypt-hashed, never stored or logged in plaintext
//
// IDEMPOTENT — safe to run repeatedly:
//   * email not found  -> create the account
//   * email exists     -> do nothing (no duplicates, password untouched)
//
// No school, no demo data and no other user is ever created here.
// Password is read from PLATFORM_SUPER_ADMIN_PASSWORD (required — no fallback)
// and NEVER printed.
//
// The document shape mirrors services/auth-service/src/models/User.js.
//
// Usage:  node scripts/bootstrap-super-admin.js

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const { resolveDbUri } = require("./lib/atlasSrv");

const BOOTSTRAP = {
  name: process.env.PLATFORM_SUPER_ADMIN_NAME || "Aiknotsit Admin",
  email: "administrator@aiknotsit.com",
  password: process.env.PLATFORM_SUPER_ADMIN_PASSWORD || "",
  role: "super_admin",
};

async function main() {
  const rawUri = process.env.AUTH_MONGODB_URI;
  if (!rawUri || !String(rawUri).trim()) {
    console.error("[bootstrap] AUTH_MONGODB_URI is not configured in .env");
    process.exit(1);
  }
  if (!BOOTSTRAP.password || !String(BOOTSTRAP.password).trim()) {
    console.error("[bootstrap] PLATFORM_SUPER_ADMIN_PASSWORD is required — refusing to create an account with a known default password");
    process.exit(1);
  }

  const client = new MongoClient(await resolveDbUri(rawUri), { serverSelectionTimeoutMS: 45000 });
  try {
    await client.connect();
    const db = client.db();
    const users = db.collection("users");

    const email = BOOTSTRAP.email.toLowerCase().trim();
    const existing = await users.findOne({ email }).catch(() => null);

    if (existing) {
      console.log("[bootstrap] administrator@aiknotsit.com already exists — nothing to do (idempotent).");
      return;
    }

    const otherSuperAdmin = await users.findOne({ role: "super_admin" }).catch(() => null);
    if (otherSuperAdmin) {
      console.log("[bootstrap] another super_admin already exists — refusing to create a second platform admin.");
      process.exit(1);
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(BOOTSTRAP.password, 10);
    await users.insertOne({
      schoolId: null,
      name: BOOTSTRAP.name.trim(),
      email,
      password: passwordHash,
      role: BOOTSTRAP.role,
      designation: null,
      class: null,
      section: null,
      phone: null,
      avatar: null,
      refId: null,
      linkedStudentIds: [],
      isActive: true,
      lastLogin: null,
      lastActivity: null,
      emailVerified: true,
      passwordChangedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`[bootstrap] created platform super admin: ${email} (role=super_admin, scope=Platform).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[bootstrap] failed:", err.message || err);
  process.exit(1);
});
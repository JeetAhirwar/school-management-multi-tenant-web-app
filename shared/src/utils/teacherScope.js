// Use the HOSTING service's mongoose instance, not this package's own copy
// (shared ships a dev-time mongoose in its node_modules whose default
// connection is never started). Services run with cwd inside their own
// directory, so process.cwd() resolves the copy whose default connection is
// the live one driving real queries.
function loadServiceMongoose() {
  try {
    const resolved = require.resolve("mongoose", { paths: [process.cwd()] });
    return require(resolved);
  } catch {
    return require("mongoose");
  }
}
const mongoose = loadServiceMongoose();

// ---------------------------------------------------------------------------
// Assignment-driven teacher scope.
//
// ROLE = who the user is  (User.role === "teacher")
// ASSIGNMENT = what the user is responsible for (TeacherAssignment)
//
// A teacher's academic authority is derived from ACTIVE TeacherAssignment
// records (type "teaching" + type "class_teacher"), not from User.class /
// User.section. The assignments live in the staff service database and the
// current academic session lives in the auth service database, so this module
// resolves them through the shared Mongo client of whichever service is
// running (same cluster in dev/production, same in-process mongod in tests).
// ---------------------------------------------------------------------------

const FALLBACK_DB = {
  staff: "erp_staff",
  auth: "erp_auth",
};

// Extracts the database name from a MongoDB URI (e.g.
// "mongodb://127.0.0.1:27017/erp_staff_test" -> "erp_staff_test").
function dbNameFromUri(uri, fallback) {
  if (!uri || !String(uri).trim()) return fallback;
  try {
    const u = new URL(String(uri).trim());
    const name = decodeURIComponent(u.pathname.replace(/^\/+/, "").replace(/\/+$/, ""));
    return name || fallback;
  } catch {
    return fallback;
  }
}

function staffDbName() {
  return dbNameFromUri(process.env.STAFF_MONGODB_URI, FALLBACK_DB.staff);
}

function authDbName() {
  return dbNameFromUri(process.env.AUTH_MONGODB_URI, FALLBACK_DB.auth);
}

// Service bundles kick off mongoose.connect() asynchronously at startup; a
// request can reach teacher-scoped middleware before the default connection
// transitions to readyState === 1. Wait for it before touching client.db() so
// scope resolution never races the initial connect.
async function ensureClient() {
  const conn = mongoose.connection;
  if (conn && conn.readyState === 1 && conn.client) return conn.client;
  if (conn && typeof conn.asPromise === "function") {
    try {
      await conn.asPromise();
    } catch {
      // Keep whatever state the connection is in; the fallback below decides.
    }
  }
  const ready = conn && conn.client ? conn.client : null;
  if (!ready) throw new Error("Mongo client is not available yet");
  return ready;
}

async function collection(dbName, name) {
  const client = await ensureClient();
  return client.db(dbName).collection(name);
}

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.isValidObjectId(value)) return new mongoose.Types.ObjectId(value);
  return null;
}

// Mirrors staff-service resolveStaffForUser: best-effort linkage via
// Staff._id (user.refId), staff email, or Staff.userId.
async function resolveStaffForUser(tenantId, user) {
  if (!user) return null;
  const staffs = await collection(staffDbName(), "staffs");
  const schoolOid = asObjectId(tenantId);
  if (!schoolOid) return null;

  const byId = user.refId && mongoose.isValidObjectId(user.refId)
    ? await staffs.findOne({ _id: new mongoose.Types.ObjectId(user.refId), schoolId: schoolOid })
    : null;
  if (byId) return byId;

  if (user.email) {
    const byEmail = await staffs.findOne({
      schoolId: schoolOid,
      email: String(user.email).toLowerCase(),
    });
    if (byEmail) return byEmail;
  }

  if (user.id) {
    return await staffs.findOne({ schoolId: schoolOid, userId: String(user.id) });
  }
  return null;
}

// Resolves the active academic session name, with two fallbacks:
//  1. AcademicSession { isCurrent: true }  (source of truth)
//  2. School.session string                (legacy mirror)
//  3. null                                 (caller decides)
async function resolveActiveSession(tenantId) {
  const schoolOid = asObjectId(tenantId);
  if (!schoolOid) return null;

  const sessions = await collection(authDbName(), "academicsessions");
  const current = await sessions.findOne({ schoolId: schoolOid, isCurrent: true });
  if (current && current.name) return String(current.name);

  const schools = await collection(authDbName(), "schools");
  const school = await schools.findOne({ _id: schoolOid }, { projection: { session: 1 } });
  if (school && school.session) return String(school.session);

  return null;
}

// Builds the teacher's assignment-derived scope for the given tenant.
// Returns null (or { allScopes: [] }) when the user is not a teaching login.
async function resolveTeacherScope({ tenantId, user }) {
  if (!user || user.role !== "teacher") return null;

  const staff = await resolveStaffForUser(tenantId, user);
  const schoolOid = asObjectId(tenantId);
  if (!staff || !schoolOid) {
    return { teaching: [], classTeacher: [], allScopes: [], hasClassTeacher: false };
  }

  const assignments = await collection(staffDbName(), "teacherassignments");
  const base = { schoolId: schoolOid, staffId: new mongoose.Types.ObjectId(staff._id), status: "active" };
  const session = await resolveActiveSession(tenantId);
  if (session) base.session = String(session);

  const records = await assignments.find(base).toArray();
  const teaching = records
    .filter((r) => r.type === "teaching")
    .map((r) => ({ class: String(r.class), section: String(r.section), subject: r.subject || null }));
  const classTeacher = records
    .filter((r) => r.type === "class_teacher")
    .map((r) => ({ class: String(r.class), section: String(r.section) }));

  const seen = new Set();
  const allScopes = [];
  [...teaching, ...classTeacher].forEach((s) => {
    const key = `${s.class}|${s.section}`;
    if (!seen.has(key)) {
      seen.add(key);
      allScopes.push({ class: s.class, section: s.section });
    }
  });

  const has = (cls, section) => {
    const c = cls == null ? null : String(cls).trim();
    if (!c) return false;
    if (section == null || String(section).trim() === "") {
      return allScopes.some((s) => s.class === c);
    }
    const sec = String(section).trim();
    return allScopes.some((s) => s.class === c && s.section === sec);
  };

  return { staff, teaching, classTeacher, allScopes, hasClassTeacher: classTeacher.length > 0, has };
}

module.exports = {
  resolveTeacherScope,
  resolveActiveSession,
  resolveStaffForUser,
  dbNameFromUri,
  staffDbName,
  authDbName,
  collection,
  asObjectId,
};
// Clean database reset — deletes EVERY document in the application databases
// (erp_auth, erp_student, erp_staff, erp_academic, erp_fee, erp_communication,
// erp_library, erp_facility) configured in the root .env.
//
// Collections and their indexes are PRESERVED — only documents are removed.
// This is intended for wiping dummy/test/development data only. There is no
// undo. Run the super admin bootstrap afterwards to bring the platform back up.
//
// Usage:  node scripts/clean-db.js

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
const { resolveDbUri } = require("./lib/atlasSrv");

const SERVICES = [
  ["AUTH_MONGODB_URI", "erp_auth"],
  ["STUDENT_MONGODB_URI", "erp_student"],
  ["STAFF_MONGODB_URI", "erp_staff"],
  ["ACADEMIC_MONGODB_URI", "erp_academic"],
  ["FEE_MONGODB_URI", "erp_fee"],
  ["COMMUNICATION_MONGODB_URI", "erp_communication"],
  ["LIBRARY_MONGODB_URI", "erp_library"],
  ["FACILITY_MONGODB_URI", "erp_facility"],
  // accounting-service falls back to the fee cluster when its own URI is
  // unset — mirror that here and pin the database name explicitly so a
  // fallback never wipes erp_fee a second time.
  ["ACCOUNTING_MONGODB_URI", "erp_accounting", "FEE_MONGODB_URI"],
];

async function cleanDatabase(name, uri, dbName) {
  if (!uri || !String(uri).trim()) {
    console.log(`[${name}] no URI configured — skipped`);
    return { removed: 0, collections: [] };
  }
  const client = new MongoClient(await resolveDbUri(uri), { serverSelectionTimeoutMS: 15000 });
  const report = { collections: [], removed: 0 };
  try {
    await client.connect();
    const db = client.db(dbName || undefined);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) {
      if (name.startsWith("system.")) continue;
      const before = await db.collection(name).countDocuments({}, { maxTimeMS: 30000 });
      const res = await db.collection(name).deleteMany({});
      report.collections.push({ name, before, removed: res.deletedCount });
      report.removed += before;
    }
    console.log(`[${name}] ${report.collections.length} collection(s), ${report.removed} document(s) removed`);
  } finally {
    await client.close();
  }
  return report;
}

(async () => {
  const totals = { removed: 0, collections: 0 };
  for (const [envKey, label, fallbackKey] of SERVICES) {
    const uri = process.env[envKey] || (fallbackKey ? process.env[fallbackKey] : null);
    const report = await cleanDatabase(label, uri, label);
    totals.removed += report.removed;
    totals.collections += report.collections.length;
  }
  console.log(`\nDONE — removed ${totals.removed} document(s) across ${totals.collections} collection(s).`);
  console.log("Collections and indexes were preserved.");
})().catch((err) => {
  console.error("[clean-db] failed:", err.message || err);
  process.exit(1);
});
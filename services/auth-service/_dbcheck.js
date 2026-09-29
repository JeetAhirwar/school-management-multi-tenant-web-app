const mongoose = require("mongoose");

// Dev-only multi-DB inspection helper. Credentials come ONLY from the
// environment — never hardcode Atlas URIs or passwords in source (P0).
const URI = process.env.MONGODB_URI || process.env.AUTH_MONGODB_URI;

if (!URI) {
  console.error(
    "[_dbcheck] Set MONGODB_URI (or AUTH_MONGODB_URI) before running this script."
  );
  process.exit(1);
}

(async () => {
  const c1 = await mongoose.createConnection(URI).asPromise();
  const db = c1.db;

  console.log("=== erp_auth > schools ===");
  console.log(JSON.stringify(await db.collection("schools").find({}).toArray(), null, 2));

  console.log("\n=== erp_auth > users ===");
  console.log(JSON.stringify(await db.collection("users").find({}).toArray(), null, 2));

  console.log("\n=== erp_staff > staffs ===");
  const sdb = (await mongoose.createConnection(URI).asPromise()).db;
  console.log(JSON.stringify(await sdb.collection("staffs").find({}).toArray(), null, 2));

  console.log("\n=== erp_student > students ===");
  const stdb = (await mongoose.createConnection(URI).asPromise()).db;
  console.log(JSON.stringify(await stdb.collection("students").find({}).toArray(), null, 2));

  await c1.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });

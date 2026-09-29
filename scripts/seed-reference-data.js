// Seed common reference data for platform owner's school edit form.
// Run: node scripts/seed-reference-data.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
const { resolveDbUri } = require("./lib/atlasSrv");

const SEEDS = {
  board: [
    "CBSE", "CISCE (ICSE/ISC)", "State Board", "IB (International Baccalaureate)",
    "Cambridge (IGCSE)", "NIOS", "Other",
  ],
  recognition_authority: [
    "CBSE", "CISCE", "State Government", "MHRD", "UGC", "AICTE",
    "AIU", "Other",
  ],
  state: [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Delhi", "Jammu & Kashmir", "Ladakh", "Chandigarh", "Puducherry",
    "Andaman & Nicobar Islands", "Dadra & Nagar Haveli", "Lakshadweep",
  ],
  city: [
    "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata",
    "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Kanpur", "Nagpur",
    "Indore", "Thane", "Bhopal", "Visakhapatnam", "Patna", "Vadodara",
    "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Faridabad", "Meerut",
    "Rajkot", "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar",
    "Navi Mumbai", "Allahabad", "Ranchi", "Howrah", "Coimbatore", "Jabalpur",
    "Gwalior", "Vijayawada", "Jodhpur", "Madurai", "Raipur", "Kochi",
    "Chandigarh", "Thiruvananthapuram", "Mysore", "Bhubaneswar", "Salem",
    "Gurgaon", "Dehradun", "Noida", "Rourkela",
  ],
};

(async () => {
  const client = new MongoClient(
    await resolveDbUri(process.env.AUTH_MONGODB_URI),
    { serverSelectionTimeoutMS: 20000 }
  );
  try {
    await client.connect();
    const db = client.db();
    const coll = db.collection("referencedata");

    let total = 0;
    for (const [category, values] of Object.entries(SEEDS)) {
      for (const value of values) {
        try {
          await coll.updateOne(
            { category, value },
            { $setOnInsert: { category, value, createdAt: new Date(), updatedAt: new Date() } },
            { upsert: true }
          );
          total++;
        } catch (err) {
          if (err.code !== 11000) console.error(`  skip ${category}/${value}:`, err.message);
        }
      }
      console.log(`[${category}] seeded ${values.length} values`);
    }
    console.log(`\nDone — ${total} reference data entries processed.`);
  } finally {
    await client.close();
  }
})().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

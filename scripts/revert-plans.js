require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1", "0.0.0.0"]);
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.AUTH_MONGODB_URI);
  const db = mongoose.connection.db;

  await db.collection("plans").deleteMany({ code: { $in: ["yearly", "three_year", "five_year"] } });

  const oldPlans = [
    { name: "Trial", code: "trial", description: "Free trial to explore the platform", price: 0, currency: "INR", billingCycle: "monthly", trialDays: 14, features: ["Up to 50 students", "Core modules", "Email support"], limits: { students: 50, staff: 10, teachers: 5, adminUsers: 2, branches: 1, storageGB: 5 }, isActive: true, isPublic: true, sortOrder: 1 },
    { name: "Basic", code: "basic", description: "For growing schools", price: 999, currency: "INR", billingCycle: "monthly", trialDays: 14, features: ["Up to 500 students", "All core modules", "1 branch", "Standard support"], limits: { students: 500, staff: 60, teachers: 40, adminUsers: 5, branches: 1, storageGB: 50 }, isActive: true, isPublic: true, sortOrder: 2 },
    { name: "Standard", code: "standard", description: "For established schools (multi-branch)", price: 2499, currency: "INR", billingCycle: "monthly", trialDays: 14, features: ["Up to 2,000 students", "All core modules", "Up to 3 branches", "Priority support"], limits: { students: 2000, staff: 250, teachers: 150, adminUsers: 10, branches: 3, storageGB: 200 }, isActive: true, isPublic: true, sortOrder: 3 },
    { name: "Premium", code: "premium", description: "For large institutions & chains", price: 4999, currency: "INR", billingCycle: "monthly", trialDays: 14, features: ["Unlimited students", "All modules + event/transport", "Unlimited branches", "Dedicated success manager"], limits: { students: null, staff: null, teachers: null, adminUsers: null, branches: null, storageGB: null }, isActive: true, isPublic: true, sortOrder: 4 },
  ];

  for (const p of oldPlans) {
    await db.collection("plans").updateOne({ code: p.code }, { $set: p }, { upsert: true });
  }

  await db.collection("schools").updateMany(
    { plan: { $in: ["yearly", "three_year", "five_year"] } },
    { $set: { plan: "basic" } }
  );

  const plans = await db.collection("plans").find({ isActive: true }).sort({ sortOrder: 1 }).toArray();
  console.log("Plans:");
  for (const p of plans) console.log(`  ${p.sortOrder}. ${p.code} ${p.name} Rs${p.price} ${p.billingCycle}`);

  await mongoose.disconnect();
})();

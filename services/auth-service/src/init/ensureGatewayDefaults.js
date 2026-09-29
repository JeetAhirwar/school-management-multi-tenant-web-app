const School = require("../models/School");
const PaymentGateway = require("../models/PaymentGateway");

// Backfill a platform-gateway (mode: platform, status: active) for any school
// created before per-school gateway configs existed. Idempotent and race-safe:
// the unique schoolId index rejects a concurrent duplicate insert.
const ensureGatewayDefaults = async () => {
  try {
    const schools = await School.find({}).select("_id").lean();
    const configured = await PaymentGateway.distinct("schoolId");
    const existing = new Set(configured.map((id) => String(id)));

    let created = 0;
    for (const school of schools) {
      if (existing.has(String(school._id))) continue;
      try {
        await PaymentGateway.create({ schoolId: school._id, mode: "platform", status: "active" });
        created++;
      } catch (err) {
        if (err.code === 11000) continue;
        throw err;
      }
    }

    console.log(`[auth-service] ensureGatewayDefaults OK: ${created} platform gateways created`);
  } catch (err) {
    console.error("[auth-service] ensureGatewayDefaults failed:", err.message);
  }
};

module.exports = ensureGatewayDefaults;
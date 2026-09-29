require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { liveness, readiness } = require("@school-erp/shared/src/health");

const feeStructureRoutes = require("./routes/feeStructureRoutes");
const concessionRoutes = require("./routes/concessionRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const paymentOrderRoutes = require("./routes/paymentOrderRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const internalPaymentRoutes = require("./routes/internalPaymentRoutes");
const { startOverdueInvoiceScheduler } = require("./services/overdueInvoices");
const { startFeeReminderScheduler } = require("./services/feeReminders");

const app = express();
const PORT = process.env.FEE_SERVICE_PORT || 5005;

// Fail boot in production when the payment provider is "enabled" with a
// known placeholder webhook secret — signatures would be forgeable.
if (
  process.env.PAYMENT_PROVIDER_ENABLED === "true" &&
  process.env.NODE_ENV === "production"
) {
  const secret = process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET || "";
  const PLACEHOLDER = /^a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4$/;
  if (!secret || PLACEHOLDER.test(secret) || secret.length < 32) {
    console.error(
      "[fee-service] PAYMENT_PROVIDER_ENABLED=true but PAYMENT_PROVIDER_WEBHOOK_SECRET is missing or a placeholder. Refusing to start."
    );
    process.exit(1);
  }
}

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
      : false,
    credentials: true,
  }),
);
app.use(morgan("dev"));

// Provider webhooks need the RAW body for signature verification — this must
// run BEFORE the JSON parser that follows.
app.use(
  "/api/webhooks",
  express.raw({ type: () => true, limit: "200kb" }),
  webhookRoutes,
);

app.use(express.json({ limit: "100kb" }));

mongoose
  .connect(process.env.FEE_MONGODB_URI, { maxPoolSize: 5 })
  .then(() =>
  {
    console.log("✅ MongoDB Connected Successfully");
    startOverdueInvoiceScheduler();
    startFeeReminderScheduler();
  })
  .catch((err) =>
  {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

app.get("/health", liveness("fee-service"));
app.get("/health/ready", readiness("fee-service", mongoose));
app.use("/api/fees/structure", feeStructureRoutes);
// Before the /api/fees catch-all so /api/fees/concessions never falls into
// invoiceRoutes' parameterised paths.
app.use("/api/fees/concessions", concessionRoutes);
app.use("/api/fees", invoiceRoutes);
app.use("/api/payments/internal", internalPaymentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/payments/orders", paymentOrderRoutes);

app.use((err, req, res, next) =>
{
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => console.log(`Fee Service running on port ${PORT}`));
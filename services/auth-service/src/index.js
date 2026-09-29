require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { liveness, readiness } = require("@school-erp/shared/src/health");

const authRoutes = require("./routes/authRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const platformRoutes = require("./routes/platformRoutes");
const internalRoutes = require("./routes/internalRoutes");
const ensureBillingDefaults = require("./init/ensureBillingDefaults");
const ensureGatewayDefaults = require("./init/ensureGatewayDefaults");
const { startTrialExpiryScheduler } = require("./services/trialExpiry");
const { startScheduledActivationScheduler } = require("./services/scheduledActivation");

const app = express();
const PORT = process.env.AUTH_SERVICE_PORT || 5001;

const connectDB = () => mongoose.connect(process.env.AUTH_MONGODB_URI, { maxPoolSize: 5 });

const start = async () =>
{
  try
  {
    await connectDB();
    await ensureBillingDefaults();
    await ensureGatewayDefaults();
    startTrialExpiryScheduler();
    startScheduledActivationScheduler();
    app.listen(PORT, () => console.log(`Auth Service running on port ${PORT}`));
  } catch (err)
  {
    console.error("[auth-service] startup failed:", err.message);
    process.exit(1);
  }
};

void start();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
      : false,
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));

app.get("/health", liveness("auth-service"));
app.get("/health/ready", readiness("auth-service", mongoose));
app.use("/api/auth/internal", internalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/auth/sessions", sessionRoutes);
app.use("/api/platform", platformRoutes);

app.use((err, req, res, next) =>
{
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

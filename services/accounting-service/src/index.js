require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { liveness, readiness } = require("@school-erp/shared/src/health");

const accountRoutes = require("./routes/accountRoutes");
const journalRoutes = require("./routes/journalRoutes");
const reportRoutes = require("./routes/reportRoutes");
const { startLedgerSweeper } = require("./services/ledgerSweeper");

const app = express();
const PORT = process.env.ACCOUNTING_SERVICE_PORT || process.env.PORT || 5009;

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
app.use(express.json({ limit: "100kb" }));

// Dedicated database preferred; fall back to the fee cluster (accounting has
// no secrets of its own and reuses an existing managed connection).  dbName
// pins the erp_accounting database either way.
const MONGO_URI = process.env.ACCOUNTING_MONGODB_URI || process.env.FEE_MONGODB_URI;
mongoose
  .connect(MONGO_URI, { maxPoolSize: 5, dbName: "erp_accounting" })
  .then(() => {
    console.log("✅ MongoDB Connected Successfully");
    startLedgerSweeper();
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

app.get("/health", liveness("accounting-service"));
app.get("/health/ready", readiness("accounting-service", mongoose));
app.use("/api/accounting/accounts", accountRoutes);
app.use("/api/accounting/journal", journalRoutes);
app.use("/api/accounting/reports", reportRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => console.log(`Accounting Service running on port ${PORT}`));

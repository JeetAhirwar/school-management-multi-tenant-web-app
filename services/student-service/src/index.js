require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("node:path");
const mongoose = require("mongoose");
const { liveness, readiness } = require("@school-erp/shared/src/health");
const morgan = require("morgan");

const studentRoutes = require("./routes/studentRoutes");
const enquiryRoutes = require("./routes/enquiryRoutes");
const documentRoutes = require("./routes/documentRoutes");
const healthRoutes = require("./routes/healthRoutes");
const internalRoutes = require("./routes/internalRoutes");
const Student = require("./models/Student");
const { startPurgeJob } = require("./jobs/purgeDeletedStudents");

const app = express();
const PORT = process.env.STUDENT_SERVICE_PORT || 5002;

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

mongoose
  .connect(process.env.STUDENT_MONGODB_URI, { maxPoolSize: 5 })
  .then(async () =>
  {
    console.log("✅ MongoDB Connected Successfully");
    // Replace the legacy full unique admissionNo index with the partial
    // (active-rows-only) one so soft-deleted slots can be re-issued. Safe
    // while no rows carry deletedAt yet (identical key set).
    try {
      await Student.syncIndexes();
      console.log("Student indexes synced (partial admissionNo unique)");
    } catch (err) {
      console.error("Student.syncIndexes failed:", err.message);
    }
    startPurgeJob();
  })
  .catch((err) =>
  {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

app.get("/health", liveness("student-service"));
app.get("/health/ready", readiness("student-service", mongoose));
app.use("/api/students/internal", internalRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/admissions", enquiryRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/health", healthRoutes);

app.use((err, req, res, next) =>
{
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => console.log(`Student Service running on port ${PORT}`));
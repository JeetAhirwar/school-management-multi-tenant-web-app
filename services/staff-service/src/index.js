require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { liveness, readiness } = require("@school-erp/shared/src/health");

const staffRoutes = require("./routes/staffRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const staffAttendanceRoutes = require("./routes/staffAttendanceRoutes");
const teacherAssignmentRoutes = require("./routes/teacherAssignmentRoutes");

const app = express();
const PORT = process.env.STAFF_SERVICE_PORT || 5003;

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
  .connect(process.env.STAFF_MONGODB_URI, { maxPoolSize: 5 })
  .then(() =>
  {
    console.log("✅ MongoDB Connected Successfully");
  })
  .catch((err) =>
  {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

app.get("/health", liveness("staff-service"));
app.get("/health/ready", readiness("staff-service", mongoose));
app.use("/api/staff/attendance", staffAttendanceRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/assignments", teacherAssignmentRoutes);

app.use((err, req, res, next) =>
{
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => console.log(`Staff Service running on port ${PORT}`));
require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { liveness, readiness } = require("@school-erp/shared/src/health");

const noticeRoutes = require("./routes/noticeRoutes");
const eventRoutes = require("./routes/eventRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const internalNotificationRoutes = require("./routes/internalNotificationRoutes");
const internalAttendanceRoutes = require("./routes/internalAttendanceRoutes");
const attendanceStreamRoutes = require("./routes/attendanceStreamRoutes");
const diaryRoutes = require("./routes/diaryRoutes");
const messageRoutes = require("./routes/messageRoutes");
const broadcastRoutes = require("./routes/broadcastRoutes");

const app = express();
const PORT = process.env.COMMUNICATION_SERVICE_PORT || 5006;

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
  .connect(process.env.COMMUNICATION_MONGODB_URI, { maxPoolSize: 5 })
  .then(() =>
  {
    console.log("✅ MongoDB Connected Successfully");
  })
  .catch((err) =>
  {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

app.get("/health", liveness("communication-service"));
app.get("/health/ready", readiness("communication-service", mongoose));
app.use("/api/notices", noticeRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/notifications/internal", internalNotificationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/attendance-stream/internal", internalAttendanceRoutes);
app.use("/api/attendance-stream", attendanceStreamRoutes);
app.use("/api/diary", diaryRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/broadcast", broadcastRoutes);

app.use((err, req, res, next) =>
{
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () =>
  console.log(`Communication Service running on port ${PORT}`),
);
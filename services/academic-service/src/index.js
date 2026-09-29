require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { liveness, readiness } = require("@school-erp/shared/src/health");
const imagekit = require("@school-erp/shared/src/config/imagekit");

const timetableRoutes = require("./routes/timetableRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const homeworkRoutes = require("./routes/homeworkRoutes");
const homeworkSubmissionRoutes = require("./routes/homeworkSubmissionRoutes");
const examRoutes = require("./routes/examRoutes");
const examMasterRoutes = require("./routes/examMasterRoutes");
const gradingScaleRoutes = require("./routes/gradingScaleRoutes");
const cceRoutes = require("./routes/cceRoutes");
const marksRoutes = require("./routes/marksRoutes");
const promotionRoutes = require("./routes/promotionRoutes");
const transferRoutes = require("./routes/transferRoutes");
const rolloverRoutes = require("./routes/rolloverRoutes");
const behaviorRoutes = require("./routes/behaviorRoutes");
const achievementRoutes = require("./routes/achievementRoutes");
const studyMaterialRoutes = require("./routes/studyMaterialRoutes");
const syllabusRoutes = require("./routes/syllabusRoutes");

const app = express();
const PORT = process.env.ACADEMIC_SERVICE_PORT || 5004;

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
  .connect(process.env.ACADEMIC_MONGODB_URI, { maxPoolSize: 5 })
  .then(() =>
  {
    console.log("✅ MongoDB Connected Successfully");
  })
  .catch((err) =>
  {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

app.get("/health", liveness("academic-service"));
app.get("/health/ready", readiness("academic-service", mongoose));
app.use("/api/timetable", timetableRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/homework/submissions", homeworkSubmissionRoutes);
app.use("/api/homework", homeworkRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/exam-masters", examMasterRoutes);
app.use("/api/grading-scales", gradingScaleRoutes);
app.use("/api/cce", cceRoutes);
app.use("/api/marks", marksRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/rollover", rolloverRoutes);
app.use("/api/behavior", behaviorRoutes);
app.use("/api/achievements", achievementRoutes);
app.use("/api/study-materials", studyMaterialRoutes);
app.use("/api/syllabus", syllabusRoutes);

app.use((err, req, res, next) =>
{
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => console.log(`Academic Service running on port ${PORT}`));

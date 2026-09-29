require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 5000;
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 300000);
const STARTED_AT = Date.now();

// Behind a reverse proxy / load balancer so express-rate-limit and req.ip
// see the real client IP (required for correct rate limiting).
app.set("trust proxy", 1);

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

// Global rate limiter - protects all downstream microservices
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});
app.use(limiter);

// Stricter, env-configurable limits on sensitive endpoints (brute-force /
// resource-exhaustion surfaces). The global limiter above still applies too.
const rate = (key, fallback) => {
  const v = Number(process.env[key] || "");
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const sensitiveLimiters = [
  { path: "/api/auth/login", window: 15 * 60 * 1000, max: rate("RATE_LIMIT_LOGIN_MAX", 10) },
  { path: "/api/auth/refresh-token", window: 15 * 60 * 1000, max: rate("RATE_LIMIT_REFRESH_MAX", 500) },
  { path: "/api/auth/change-password", window: 15 * 60 * 1000, max: rate("RATE_LIMIT_CHANGE_PASSWORD_MAX", 100) },
  { path: "/api/auth/register", window: 15 * 60 * 1000, max: rate("RATE_LIMIT_REGISTER_MAX", 50) },
  { path: "/api/auth/reset-password", window: 15 * 60 * 1000, max: rate("RATE_LIMIT_RESET_PASSWORD_MAX", 100) },
  { path: "/api/auth/users/:id/reset-password", window: 15 * 60 * 1000, max: rate("RATE_LIMIT_ADMIN_RESET_MAX", 200) },
  { path: "/api/payments/orders", window: 15 * 60 * 1000, max: rate("RATE_LIMIT_PAYMENT_CREATE_MAX", 300) },
];
sensitiveLimiters.forEach(({ path, window, max }) => {
  app.use(
    path,
    rateLimit({
      windowMs: window,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: "Too many requests, please try again later." },
    }),
  );
});

// Internal-only endpoints are NOT reachable by public clients: the gateway
// requires the shared x-internal-key header on them. Service-to-service calls
// (which supply that header) pass through so the split-deployment instances
// can reach each other; everyone else gets a 404.
const INTERNAL_PREFIXES = [
  "/api/notifications/internal",
  "/api/students/internal",
  "/api/auth/internal",
  "/api/payments/internal",
  "/api/attendance-stream/internal",
];
app.use((req, res, next) => {
  const isInternal = INTERNAL_PREFIXES.some((p) => req.path.startsWith(p));
  if (!isInternal) return next();
  const presented = req.headers["x-internal-key"];
  const expected = process.env.INTERNAL_NOTIFY_KEY;
  const valid =
    presented &&
    expected &&
    presented.length === expected.length &&
    Buffer.from(String(presented), "utf8").equals(
      Buffer.from(String(expected), "utf8"),
    );
  if (!valid) {
    return res
      .status(404)
      .json({ success: false, message: "Route not found on API Gateway" });
  }
  next();
});

// Liveness: the gateway itself is up (never touches downstream services, so
// a dependency blip can't fail the monolith startup poll or a deploy check).
app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    success: true,
    service: "api-gateway",
    status: "UP",
    uptime: Math.round((Date.now() - STARTED_AT) / 1000),
    time: new Date().toISOString(),
  });
});

// Route map: gateway path -> downstream microservice
const routes = [
  {
    path: "/api/auth",
    target: process.env.AUTH_SERVICE_URL || "http://localhost:5001",
  },
  {
    path: "/api/platform",
    target: process.env.AUTH_SERVICE_URL || "http://localhost:5001",
  },
  {
    path: "/api/students",
    target: process.env.STUDENT_SERVICE_URL || "http://localhost:5002",
  },
  {
    path: "/api/documents",
    target: process.env.STUDENT_SERVICE_URL || "http://localhost:5002",
  },
  {
    path: "/api/admissions",
    target: process.env.STUDENT_SERVICE_URL || "http://localhost:5002",
  },
  {
    path: "/api/staff",
    target: process.env.STAFF_SERVICE_URL || "http://localhost:5003",
  },
  {
    path: "/api/leaves",
    target: process.env.STAFF_SERVICE_URL || "http://localhost:5003",
  },
  {
    path: "/api/payroll",
    target: process.env.STAFF_SERVICE_URL || "http://localhost:5003",
  },
  {
    path: "/api/assignments",
    target: process.env.STAFF_SERVICE_URL || "http://localhost:5003",
  },
  {
    path: "/api/attendance",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/timetable",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/homework",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/exams",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/exam-masters",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/grading-scales",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/cce",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/marks",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/promotions",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/transfers",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/rollover",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/behavior",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/achievements",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/study-materials",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/syllabus",
    target: process.env.ACADEMIC_SERVICE_URL || "http://localhost:5004",
  },
  {
    path: "/api/health",
    target: process.env.STUDENT_SERVICE_URL || "http://localhost:5002",
  },
  {
    path: "/api/fees",
    target: process.env.FEE_SERVICE_URL || "http://localhost:5005",
  },
  {
    path: "/api/payments",
    target: process.env.FEE_SERVICE_URL || "http://localhost:5005",
  },
  {
    path: "/api/webhooks",
    target: process.env.FEE_SERVICE_URL || "http://localhost:5005",
  },
  {
    path: "/api/notices",
    target: process.env.COMMUNICATION_SERVICE_URL || "http://localhost:5006",
  },
  {
    path: "/api/events",
    target: process.env.COMMUNICATION_SERVICE_URL || "http://localhost:5006",
  },
  {
    path: "/api/notifications",
    target: process.env.COMMUNICATION_SERVICE_URL || "http://localhost:5006",
  },
  {
    path: "/api/attendance-stream",
    target: process.env.COMMUNICATION_SERVICE_URL || "http://localhost:5006",
  },
  {
    path: "/api/diary",
    target: process.env.COMMUNICATION_SERVICE_URL || "http://localhost:5006",
  },
  {
    path: "/api/messages",
    target: process.env.COMMUNICATION_SERVICE_URL || "http://localhost:5006",
  },
  {
    path: "/api/broadcast",
    target: process.env.COMMUNICATION_SERVICE_URL || "http://localhost:5006",
  },
  {
    path: "/api/library",
    target: process.env.LIBRARY_SERVICE_URL || "http://localhost:5007",
  },
  {
    path: "/api/hostel",
    target: process.env.FACILITY_SERVICE_URL || "http://localhost:5008",
  },
  {
    path: "/api/transport",
    target: process.env.FACILITY_SERVICE_URL || "http://localhost:5008",
  },
  {
    path: "/api/inventory",
    target: process.env.FACILITY_SERVICE_URL || "http://localhost:5008",
  },
  {
    path: "/api/accounting",
    target: process.env.ACCOUNTING_SERVICE_URL || "http://localhost:5009",
  },
];

routes.forEach(({ path, target }) => {
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      timeout: PROXY_TIMEOUT_MS,
      proxyTimeout: PROXY_TIMEOUT_MS,
      pathRewrite: (_requestPath, req) => req.originalUrl,
      on: {
        error: (_error, _request, response) => {
          if (!response.headersSent) {
            response.status(503).json({
              success: false,
              message: "Requested service is temporarily unavailable",
            });
          }
        },
      },
    }),
  );
});

// Readiness: the gateway holds no DB connection of its own, so it fans out to
// every downstream service's /health/ready (each of those pings MongoDB).
// Registered after `routes` (defined above) and before the 404 fallback.
app.get("/health/ready", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const targets = [...new Set(routes.map((r) => r.target))];
  const services = await Promise.all(
    targets.map(async (target) => {
      try {
        const r = await fetch(`${target}/health/ready`, {
          signal: AbortSignal.timeout(4000),
        });
        return { target, ok: r.ok, status: r.status };
      } catch (err) {
        return { target, ok: false, error: err.message };
      }
    }),
  );
  const ok = services.every((s) => s.ok);
  res.status(ok ? 200 : 503).json({
    success: ok,
    service: "api-gateway",
    status: ok ? "UP" : "DEGRADED",
    checks: { services },
    time: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res
    .status(404)
    .json({ success: false, message: "Route not found on API Gateway" });
});

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});

// Health check: verifies all microservices through the gateway.
// Usage: node scripts/health-check.js [GATEWAY_URL]
const BASE = process.argv[2] || "http://localhost:5000";

const CHECKS = [
  { name: "api-gateway",      url: "/health" },
  { name: "auth-service",     url: "/api/auth/schools" },
  { name: "student-service",  url: "/api/students/stats" },
  { name: "staff-service",    url: "/api/staff" },
  { name: "academic-service", url: "/api/attendance" },
  { name: "fee-service",      url: "/api/fees/invoices" },
  { name: "library-service",  url: "/api/library/books" },
  { name: "facility-service", url: "/api/transport" },
  { name: "accounting-service", url: "/api/accounting/accounts" },
];

async function check({ name, url }) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${url}`, {
      headers: { Authorization: "Bearer __health_check__" },
      signal: AbortSignal.timeout(10000),
    });
    const ms = Date.now() - start;
    const status = res.status === 401 || res.status === 200 ? "UP" : `WARN (${res.status})`;
    return { name, status, ms, error: null };
  } catch (err) {
    const ms = Date.now() - start;
    const status = err.name === "TimeoutError" ? "TIMEOUT" : "DOWN";
    return { name, status, ms, error: err.message?.slice(0, 60) };
  }
}

(async () => {
  console.log(`Checking services at ${BASE} …\n`);
  const results = await Promise.all(CHECKS.map(check));
  for (const r of results) {
    const icon = r.status === "UP" ? "✓" : "✗";
    const line = `  ${icon} ${r.name.padEnd(20)} ${r.status.padEnd(12)} ${r.ms}ms`;
    console.log(line);
    if (r.error) console.log(`    └─ ${r.error}`);
  }
  const down = results.filter((r) => r.status !== "UP");
  console.log(`\n${down.length === 0 ? "All services UP ✓" : `${down.length} service(s) down ✗`}`);
})();

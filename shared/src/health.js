// Shared health endpoints consumed by every service via
// `@school-erp/shared/src/health` (canonical copy — do not duplicate).
//
//   GET /health         liveness  -> 200 while the process is up (never checks
//                                    dependencies, so a DB blip cannot fail the
//                                    monolith startup poll or a deploy healthcheck)
//   GET /health/ready   readiness -> 200 only when MongoDB answers a ping;
//                                    503 otherwise (for monitors / uptime alerts)
//
// IMPORTANT: each service has its own installed copy of mongoose, so the
// connection MUST be handed in by the caller (`readiness(name, mongoose)`),
// otherwise this module would inspect a different, never-connected instance.

const mongoose = require("mongoose");

const BOOTED_AT = Date.now();
const STATES = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
const PING_TIMEOUT_MS = 2000;
const CACHE_MS = 3000;

let cache = { at: 0, result: null };

function pickConnection(mongooseInstance) {
  const m = mongooseInstance || mongoose;
  if (m.connection && typeof m.connection.readyState === "number") return m.connection;
  if (typeof m.readyState === "number") return m; // a Connection passed directly
  return mongoose.connection;
}

async function mongoStatus(mongooseInstance) {
  if (Date.now() - cache.at < CACHE_MS) return cache.result;

  const conn = pickConnection(mongooseInstance);
  const state = STATES[conn.readyState] || "unknown";
  let result;

  if (conn.readyState !== 1 || !conn.db) {
    result = { ok: false, state };
  } else {
    try {
      await Promise.race([
        conn.db.command({ ping: 1 }),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("ping timeout")), PING_TIMEOUT_MS),
        ),
      ]);
      result = { ok: true, state };
    } catch (err) {
      result = { ok: false, state, error: err.message };
    }
  }

  cache = { at: Date.now(), result };
  return result;
}

function liveness(serviceName) {
  return (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      service: serviceName,
      status: "UP",
      uptime: Math.round((Date.now() - BOOTED_AT) / 1000),
      time: new Date().toISOString(),
    });
  };
}

function readiness(serviceName, mongooseInstance) {
  return async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const database = await mongoStatus(mongooseInstance);
      const ok = database.ok;
      res.status(ok ? 200 : 503).json({
        success: ok,
        service: serviceName,
        status: ok ? "UP" : "DEGRADED",
        checks: {
          server: { status: "UP", uptime: Math.round((Date.now() - BOOTED_AT) / 1000) },
          database,
        },
        time: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({
        success: false,
        service: serviceName,
        status: "DEGRADED",
        message: err.message,
        time: new Date().toISOString(),
      });
    }
  };
}

module.exports = { liveness, readiness, mongoStatus, pickConnection };

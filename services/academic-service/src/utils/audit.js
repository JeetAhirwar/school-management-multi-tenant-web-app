const mongoose = require("mongoose");
const {
  createAuditModel,
  createAuditWriter,
} = require("@school-erp/shared/src/audit");

// Cross-service audit writer for master-data lifecycle events.
//
// The AuditLog collection lives in the auth-service database; academic-service
// reaches it through a lazy secondary connection to AUTH_MONGODB_URI. When the
// URI is not configured (local dev, tests that don't exercise auditing) master
// actions are skipped silently - auditing never blocks the primary operation.
let auditConnection = null;
let writer = null;

function writeMasterAudit({ req, action, targetId = null, message = "" }) {
  if (!writer) {
    const uri = process.env.AUTH_MONGODB_URI;
    if (!uri) return Promise.resolve();
    try {
      auditConnection = mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 3000,
      });
      writer = createAuditWriter(createAuditModel(auditConnection));
    } catch (err) {
      console.error("[master-audit] init failed:", err.message);
      return Promise.resolve();
    }
  }
  return writer({
    req,
    action,
    targetType: "master",
    targetId: targetId ? String(targetId) : null,
    message,
  });
}

module.exports = { writeMasterAudit };
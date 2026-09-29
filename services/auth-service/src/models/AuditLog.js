const mongoose = require("mongoose");
const { auditLogSchema, AUDIT_ACTIONS } = require("@school-erp/shared/src/audit");

// Append-oriented platform audit trail (schema lives in shared so every service
// writes through the same contract to the single AuditLog collection).
const AuditLog = mongoose.model("AuditLog", auditLogSchema);

module.exports = AuditLog;
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
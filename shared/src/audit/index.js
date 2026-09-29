const mongoose = require("mongoose");

// Append-oriented platform audit trail. Records sensitive platform actions:
// who did what, to which entity, when, and the outcome. Never stores passwords,
// JWTs, refresh tokens, or secret values. Ordinary controllers must not modify
// or delete these documents once written.
//
// Lives in `shared` so any service can write to the single AuditLog collection
// (auth-service owns the collection; other services reuse this schema via a
// secondary mongoose connection to the auth database).
const AUDIT_ACTIONS = [
  "login",
  "logout",
  "user.created",
  "user.updated",
  "user.deactivated",
  "user.soft_deleted",
  "user.restored",
  "school.created",
  "school.updated",
  "school.suspended",
  "school.activated",
  "school.deactivated",
  "school.reactivated",
  "plan.created",
  "plan.updated",
  "plan.deactivated",
  "plan.archived",
  "subscription.created",
  "subscription.changed",
  "subscription.suspended",
  "subscription.reactivated",
  "subscription.cancelled",
  "invoice.generated",
  "invoice.updated",
  "report.generated",
  "settings.changed",
  // Master-data lifecycle events (academic-service school-owned masters).
  "master.created",
  "master.updated",
  "master.deactivated",
  "master.restored",
];

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, trim: true, default: null },
    actorRole: { type: String, default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    targetType: {
      type: String,
      enum: ["school", "user", "plan", "subscription", "invoice", "report", "setting", "master"],
      default: null,
    },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    result: {
      type: String,
      enum: ["success", "failure"],
      default: "success",
    },
    message: { type: String, default: "" },
    reason: { type: String, default: null },
    context: {
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
      xSchoolId: { type: String, default: null },
    },
  },
  {
    timestamps: true,
    // Existing docs are only read and appended to; disable modification paths
    // unless explicitly allowed by a privileged flow.
    strict: "throw",
  }
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });
auditLogSchema.index({ createdAt: -1 });

// Registers the AuditLog model on the given mongoose instance/connection so the
// caller controls which database backs the writes (auth-service: its default
// connection; other services: a secondary connection to the auth database).
function createAuditModel(conn) {
  return conn.model("AuditLog", auditLogSchema);
}

// Best-effort, non-blocking audit write. Sensitive platform actions call this
// AFTER they succeed (or with result:"failure") so the main request is never
// dependent on the audit write succeeding.
function createAuditWriter(model) {
  return async ({ req, user, action, targetType, targetId, result = "success", message = "", reason = null }) => {
    try {
      const actor = user || (req && req.user) || {};
      const context = {
        ip: (req && (req.ip || req.connection?.remoteAddress)) || null,
        userAgent: (req && req.headers["user-agent"]) || null,
        xSchoolId: (req && req.headers["x-school-id"]) || null,
      };
      const doc = new model({
        actorId: actor.id || actor._id || null,
        actorEmail: actor.email || null,
        actorRole: actor.role || null,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        result,
        message: typeof message === "string" ? message.slice(0, 500) : "",
        reason: reason || null,
        context,
      });
      await doc.save();
    } catch (err) {
      // Audit must never fail the primary operation.
      console.error("[audit] write failed:", err.message);
    }
  };
}

module.exports = { AUDIT_ACTIONS, auditLogSchema, createAuditModel, createAuditWriter };
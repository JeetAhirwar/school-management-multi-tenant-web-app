const AuditLog = require("../models/AuditLog");

// Best-effort, non-blocking audit write. Sensitive platform actions call this
// AFTER they succeed (or with result:"failure") so the main request is never
// dependent on the audit write succeeding.
const writeAudit = async ({ req, user, action, targetType, targetId, result = "success", message = "", reason = null }) => {
  try {
    const actor = user || (req && req.user) || {};
    const context = {
      ip: (req && (req.ip || req.connection?.remoteAddress)) || null,
      userAgent: (req && req.headers["user-agent"]) || null,
      xSchoolId: (req && req.headers["x-school-id"]) || null,
    };
    const doc = new AuditLog({
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

module.exports = { writeAudit };
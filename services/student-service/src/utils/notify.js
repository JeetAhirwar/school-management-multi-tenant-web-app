// [INTERNAL] Pushes inbox notifications to the communication service using the
// shared service-to-service key (INTERNAL_NOTIFY_KEY). Failure is non-fatal:
// the originating action still completes if the notification push fails.
const COMM_URL = process.env.COMMUNICATION_SERVICE_URL || `http://localhost:${process.env.COMMUNICATION_SERVICE_PORT || 5006}`;
const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;

async function notifyByRefIds({ schoolId, refIds, title, message, kind = "system", link = null }) {
  const targets = [...new Set((refIds || []).map((u) => String(u)).filter(Boolean))];
  if (!INTERNAL_KEY || targets.length === 0) return null;
  try {
    const res = await fetch(`${COMM_URL}/api/notifications/internal/push-by-refs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify({ schoolId: String(schoolId || ""), refIds: targets, title, message, kind, link }),
    });
    if (!res.ok) throw new Error(`[notify] ${res.status} ${await res.text()}`);
    return await res.json();
  } catch (err) {
    console.error("[notification push skipped]", err.message);
    return null;
  }
}

async function notifyByRoles({ schoolId, roles, designations = [], title, message, kind = "system", link = null }) {
  if (!INTERNAL_KEY || !roles || roles.length === 0) return null;
  try {
    const res = await fetch(`${COMM_URL}/api/notifications/internal/push-by-roles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify({ schoolId: String(schoolId || ""), roles, designations, title, message, kind, link }),
    });
    if (!res.ok) throw new Error(`[notify-roles] ${res.status} ${await res.text()}`);
    return await res.json();
  } catch (err) {
    console.error("[notification push-by-roles skipped]", err.message);
    return null;
  }
}

module.exports = { notifyByRefIds, notifyByRoles };
// Pushes inbox notifications to the communication service.
// - pushNotifications: uses the acting admin's JWT (admin-initiated actions).
// - notifyByRefIds: [INTERNAL] resolves User.refId values inside the school
//   via the shared service-to-service key (INTERNAL_NOTIFY_KEY) — used where
//   no admin token exists, e.g. student leaves keyed by admissionNo.
// Failure is non-fatal: the originating action still completes if the push fails.
const COMM_URL = process.env.COMMUNICATION_SERVICE_URL || `http://localhost:${process.env.COMMUNICATION_SERVICE_PORT || 5006}`;
const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;

async function pushNotifications({ token, schoolId, userIds, title, message, kind = "system", link = null }) {
  const targets = [...new Set((userIds || []).map((u) => String(u)).filter(Boolean))];
  if (!token || targets.length === 0) return null;
  try {
    const res = await fetch(`${COMM_URL}/api/notifications/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-School-Id": String(schoolId || ""),
      },
      body: JSON.stringify({ userIds: targets, title, message, kind, link }),
    });
    if (!res.ok) throw new Error(`[notify] ${res.status} ${await res.text()}`);
    return await res.json();
  } catch (err) {
    console.error("[notification push skipped]", err.message);
    return null;
  }
}

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

module.exports = { pushNotifications, notifyByRefIds };

// [INTERNAL] Pushes inbox notifications to the communication service using the
// shared service-to-service key (INTERNAL_NOTIFY_KEY). Failure is non-fatal:
// the originating action still completes if the notification push fails.
const COMM_URL = process.env.COMMUNICATION_SERVICE_URL || `http://localhost:${process.env.COMMUNICATION_SERVICE_PORT || 5006}`;
const STUDENT_URL = process.env.STUDENT_SERVICE_URL || `http://localhost:${process.env.STUDENT_SERVICE_PORT || 5002}`;
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

// Resolves the active student admissionNos for a class (and optional section)
// via the student-service internal endpoint, then notifies them.
async function notifyClassStudents({ schoolId, class: cls, section, title, message, kind = "system", link = null }) {
  if (!INTERNAL_KEY || !schoolId || !cls) return null;
  let refIds = [];
  try {
    const params = new URLSearchParams({ schoolId: String(schoolId), class: String(cls) });
    if (section) params.set("section", String(section));
    const res = await fetch(`${STUDENT_URL}/api/students/internal/by-class?${params}`, {
      headers: { "X-Internal-Key": INTERNAL_KEY },
    });
    if (!res.ok) throw new Error(`[roster] ${res.status} ${await res.text()}`);
    const body = await res.json();
    refIds = body?.refIds || [];
  } catch (err) {
    console.error("[class roster skipped]", err.message);
  }
  if (refIds.length === 0) return null;
  return notifyByRefIds({ schoolId, refIds, title, message, kind, link });
}

module.exports = { notifyByRefIds, notifyClassStudents };
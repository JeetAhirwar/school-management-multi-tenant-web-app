// [INTERNAL] Best-effort cascade hooks into auth-service when a student is
// soft-deleted or purged (student-service cannot write to the auth database
// directly). Uses the shared INTERNAL_NOTIFY_KEY; every call is non-fatal —
// the student action always completes even if auth-service is unreachable
// (same convention as utils/notify.js).
const AUTH_URL = process.env.AUTH_SERVICE_URL || `http://localhost:${process.env.AUTH_SERVICE_PORT || 5001}`;
const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;

async function callAuth(path, body) {
  if (!INTERNAL_KEY) return null;
  try {
    const res = await fetch(`${AUTH_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`[auth-cascade] ${res.status} ${await res.text()}`);
    return await res.json();
  } catch (err) {
    console.error("[auth cascade skipped]", err.message);
    return null;
  }
}

// Soft-delete of the student: deactivate the linked login so the account can
// no longer authenticate (verifyToken rejects inactive users).
function deactivateStudentUser({ schoolId, admissionNo }) {
  return callAuth("/api/auth/internal/users/deactivate-by-student", {
    schoolId: String(schoolId || ""),
    admissionNo: String(admissionNo || ""),
  });
}

// Final purge: remove the linked login entirely once the retention window
// has elapsed and the student row is being hard-deleted.
function purgeStudentUser({ schoolId, admissionNo }) {
  return callAuth("/api/auth/internal/users/purge-by-student", {
    schoolId: String(schoolId || ""),
    admissionNo: String(admissionNo || ""),
  });
}

module.exports = { deactivateStudentUser, purgeStudentUser };

// [INTERNAL] Resolves an academic-session label ("2026-27") to its calendar
// window via the auth-service internal endpoint (session calendars live in the
// auth database). Uses the shared service-to-service key (INTERNAL_NOTIFY_KEY,
// same convention as notify.js). Failure is non-fatal: returns null so callers
// fall back to an unbounded window.
const AUTH_URL =
  process.env.AUTH_SERVICE_URL || `http://localhost:${process.env.AUTH_SERVICE_PORT || 5001}`;
const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;

async function fetchSessionWindow(schoolId, name) {
  if (!INTERNAL_KEY || !schoolId || !String(name || "").trim()) return null;
  try {
    const params = new URLSearchParams({
      schoolId: String(schoolId),
      name: String(name).trim(),
    });
    const res = await fetch(`${AUTH_URL}/api/auth/internal/sessions/window?${params}`, {
      headers: { "X-Internal-Key": INTERNAL_KEY },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data || null;
  } catch (err) {
    console.error("[session window skipped]", err.message);
    return null;
  }
}

module.exports = { fetchSessionWindow };

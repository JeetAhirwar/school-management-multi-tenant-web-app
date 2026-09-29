// Email relay to the auth-service SMTP relay (INTERNAL route). SMTP lives in
// the auth process; this service only forwards. Best-effort and non-fatal —
// every call resolves with a structured result instead of throwing, so a
// broadcast can always write its audit log.
const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;
const AUTH_URL = process.env.AUTH_SERVICE_URL || "http://localhost:5001";
const RELAY_MAX_PER_CALL = 20; // auth relay hard-caps `to` at 20

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

// Sends one chunk of up to 20 addresses. Returns { sent, failed } or null when
// the relay/key is not configured (never throws).
const sendChunk = async (to, subject, html) => {
  if (!INTERNAL_KEY || to.length === 0) return null;
  try {
    const res = await fetch(`${AUTH_URL}/api/auth/internal/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify({ to, subject, html }),
    });
    if (!res.ok) throw new Error(`[email-relay] ${res.status} ${await res.text()}`);
    const json = await res.json();
    return json.data || { sent: 0, failed: to.length };
  } catch (err) {
    console.error("[email relay chunk skipped]", err.message);
    return { sent: 0, failed: to.length };
  }
};

// Sends to any number of recipients, chunking by the relay's 20-per-call cap.
// Returns { sent, failed, skipped } — skipped > 0 means SMTP/key unconfigured.
const sendEmailBulk = async ({ to, subject, html }) => {
  const targets = [...new Set((to || []).map((e) => String(e).trim()).filter((e) => e.includes("@")))];
  if (targets.length === 0) return { sent: 0, failed: 0, skipped: 0 };
  if (!INTERNAL_KEY || !smtpConfigured()) {
    return { sent: 0, failed: 0, skipped: targets.length };
  }
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i += RELAY_MAX_PER_CALL) {
    const chunk = targets.slice(i, i + RELAY_MAX_PER_CALL);
    const result = await sendChunk(chunk, subject, html);
    if (result) {
      sent += result.sent || 0;
      failed += result.failed || 0;
    } else {
      failed += chunk.length;
    }
  }
  return { sent, failed, skipped: 0 };
};

module.exports = { sendEmailBulk, smtpConfigured, RELAY_MAX_PER_CALL };

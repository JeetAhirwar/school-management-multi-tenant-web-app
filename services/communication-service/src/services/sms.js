// SMS provider adapter. OFF by default (SMS_PROVIDER_ENABLED is not "true"):
// when off, sends become console "dry-run" logs so the whole broadcast flow
// can be exercised without a paid provider.
//
// Providers:
//   - "http":    generic HTTP gateway — POST { to, message, senderId, apiKey }
//                to SMS_API_URL (shape is provider-specific; documented in
//                .env.example).
//   - "twilio":  Twilio Messages API (SMS_TWILIO_SID / TOKEN / FROM).
//
// Never throws: every send resolves to a structured result so the caller can
// write its audit log either way.

const CHUNK_SIZE = 10;

const isEnabled = () => process.env.SMS_PROVIDER_ENABLED === "true";

const sendOne = async ({ to, message }) => {
  const provider = (process.env.SMS_PROVIDER || "http").toLowerCase();
  if (!isEnabled()) {
    console.log(`[sms dry-run] to=${to} message="${message}"`);
    return { ok: true, dryRun: true };
  }
  try {
    if (provider === "twilio") {
      const sid = process.env.SMS_TWILIO_SID;
      const token = process.env.SMS_TWILIO_TOKEN;
      const from = process.env.SMS_TWILIO_FROM;
      if (!sid || !token || !from) throw new Error("Twilio credentials not configured");
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: message }),
      });
      if (!res.ok) throw new Error(`twilio ${res.status} ${await res.text()}`);
      return { ok: true, dryRun: false };
    }
    // Generic HTTP gateway.
    const url = process.env.SMS_API_URL;
    if (!url) throw new Error("SMS_API_URL not configured");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        message,
        senderId: process.env.SMS_SENDER_ID || "",
        apiKey: process.env.SMS_API_KEY || "",
      }),
    });
    if (!res.ok) throw new Error(`sms-gateway ${res.status} ${await res.text()}`);
    return { ok: true, dryRun: false };
  } catch (err) {
    console.error(`[sms failed] to=${to}:`, err.message);
    return { ok: false, dryRun: false, error: err.message };
  }
};

// Sends to a list in chunks of 10. Returns { sent, failed, dryRun }.
const sendSmsBulk = async ({ numbers, message }) => {
  const targets = [
    ...new Set(
      (numbers || [])
        .map((n) => String(n).replace(/[^\d+]/g, ""))
        .filter((n) => n.replace(/\D/g, "").length >= 7)
    ),
  ];
  if (targets.length === 0) return { sent: 0, failed: 0, dryRun: !isEnabled() };
  let sent = 0;
  let failed = 0;
  let dryRun = false;
  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    const results = await Promise.allSettled(
      targets.slice(i, i + CHUNK_SIZE).map((to) => sendOne({ to, message }))
    );
    results.forEach((r) => {
      if (r.status === "fulfilled") {
        if (r.value.dryRun) dryRun = true;
        if (r.value.ok) sent += 1;
        else failed += 1;
      } else {
        failed += 1;
      }
    });
  }
  return { sent, failed, dryRun };
};

module.exports = { sendSmsBulk, isEnabled, CHUNK_SIZE };

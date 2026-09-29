// Cross-service academic referential integrity check.
//
// Student/staff/fee services do not own the master catalogs (classes, sections,
// subjects, rooms live in academic-service's database). To prevent assigning
// nonexistent master values, these services POST the caller's proposed values
// to academic-service's /api/exam-masters/validate-refs endpoint, forwarding
// the caller's Bearer token + X-School-Id so academic re-uses the same identity
// and tenant.
//
// FAIL-OPEN by design. This is a soft integrity gate, not an authorization
// check:
//  - If no academic service URL is resolvable, the check is skipped.
//  - If academic-service is unreachable/times out, the write proceeds (logged
//    once per process).
//  - The academic endpoint itself skips any kind whose tenant catalog is empty
//    (legacy free-string schools keep working).
// Only a 400 "unknown academic value" response blocks the write.

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function resolveBaseUrl() {
  const explicit =
    process.env.ACADEMIC_REF_URL ||
    process.env.ACADEMIC_SERVICE_URL ||
    (process.env.ACADEMIC_SERVICE_PORT
      ? `http://localhost:${process.env.ACADEMIC_SERVICE_PORT}`
      : null);
  return (explicit || "http://localhost:5004").replace(/\/+$/, "");
}

let warned = false;

async function assertAcademicRefs({ req, values }) {
  const payload = {};
  for (const key of ["class", "section", "subject", "room", "feeType"]) {
    const value = values && values[key];
    if (value != null && String(value).trim() !== "") {
      payload[key] = String(value).trim();
    }
  }
  if (Object.keys(payload).length === 0) return;

  const url = resolveBaseUrl();
  const headers = { "content-type": "application/json" };
  if (req && req.headers) {
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers["x-school-id"]) headers["x-school-id"] = req.headers["x-school-id"];
  }

  let res;
  try {
    res = await fetch(`${url}/api/exam-masters/validate-refs`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    });
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`[ref-validation] academic-service unreachable (${url}); skipping referential check: ${err.message}`);
    }
    return;
  }

  if (res.status === 400) {
    let message = "Academic reference validation failed";
    try {
      const data = await res.json();
      if (data && data.message) message = data.message;
    } catch {}
    throw httpError(400, message);
  }
  // Any other status (401/403/5xx) is treated as unavailable -> fail-open.
}

module.exports = { assertAcademicRefs };
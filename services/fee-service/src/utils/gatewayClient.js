// Resolves a school's active payment gateway config from auth-service
// (the single source of truth for per-school gateways). The response is
// already decrypted by auth's internal endpoint; we cache it briefly so the
// engine doesn't hammer auth on every order/webhook.
const AUTH_URL = process.env.AUTH_SERVICE_URL || "http://localhost:5001";
const INTERNAL_KEY = process.env.INTERNAL_NOTIFY_KEY;

const cache = new Map();

const keyUsable = () => Boolean(INTERNAL_KEY && String(INTERNAL_KEY).length >= 32);

const fetchConfig = async (query) => {
  if (!keyUsable()) return null;
  try {
    const res = await fetch(
      `${AUTH_URL}/api/auth/internal/payment-gateway?${new URLSearchParams(query)}`,
      { headers: { "x-internal-key": INTERNAL_KEY }, signal: AbortSignal.timeout(10000) }
    );
    const json = await res.json();
    return json?.success && json.data ? json.data : null;
  } catch {
    return null;
  }
};

const cacheGet = (key) => {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  cache.delete(key);
  return undefined;
};

const getGatewayConfig = async (schoolId, { ttlMs = 30000 } = {}) => {
  const cacheKey = `school:${String(schoolId)}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  const value = await fetchConfig({ schoolId });
  if (value) cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  return value;
};

const getGatewayConfigByCode = async (schoolCode, { ttlMs = 30000 } = {}) => {
  const cacheKey = `code:${String(schoolCode).toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  const value = await fetchConfig({ schoolCode });
  if (value) cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  return value;
};

const clearGatewayCache = (schoolId) => {
  if (schoolId) {
    cache.delete(`school:${schoolId}`);
    if (schoolId._id) cache.delete(`school:${String(schoolId._id)}`);
  } else {
    cache.clear();
  }
};

module.exports = { getGatewayConfig, getGatewayConfigByCode, clearGatewayCache };
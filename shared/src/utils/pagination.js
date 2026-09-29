// Shared pagination helper (single source of truth in @school-erp/shared;
// previously copied per service). Bounds list queries and exposes
// total/page/pages so unbounded collections stay cheap and pager-friendly.
// Default page size 500 keeps existing bulk UI calls (limit=500/1000) working;
// max caps every response.
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

function paginate(query = {}, overrides = {}) {
  const max = overrides.max || MAX_LIMIT;
  const fallback = overrides.fallback || DEFAULT_LIMIT;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(query.limit, 10) || fallback));
  return { page, limit, skip: (page - 1) * limit };
}

function pageInfo(total, page, limit) {
  return { page, limit, pages: Math.ceil(total / limit) };
}

module.exports = { paginate, pageInfo, MAX_LIMIT, DEFAULT_LIMIT };
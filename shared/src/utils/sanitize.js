// Coerces a raw Express query/body value into a safe scalar string for Mongo
// filters. Express 4's default `extended` query parser (qs) turns
// `?field[$ne]=x` into a nested object, so dropping objects/arrays here closes
// operator smuggling (`$ne`, `$regex`, `$gt`, ...) without changing behaviour
// for ordinary values. Undefined/empty results are dropped (falsy gate).
const scalar = (value, max = 200) => {
  if (value == null) return undefined;
  if (typeof value === "object") return undefined;
  const s = String(value).trim().slice(0, max);
  return s === "" ? undefined : s;
};

module.exports = { scalar };
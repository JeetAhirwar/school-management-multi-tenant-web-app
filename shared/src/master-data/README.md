# Platform-Wide Master Data — Classification

Shared factory: `@school-erp/shared/src/master-data`. Adopted by the
academic-service via `createMasterController`.

## What a master is

A **master** is a small catalog record an admin fills in once and every other
module reads as a dropdown option: exam types, classes, sections, subjects,
time slots, rooms. They are the "reference data" layer underneath the
transactional modules (scheduling exams, entering marks, timetables).

## Classification rules

Every master is classified along three axes. A new master must declare all of
them in its `kindConfig` before it is added to a service.

### 1. Scope

| Scope    | Owner      | `schoolId` | Who can create | Can be deactivated |
| -------- | ---------- | ---------- | -------------- | ------------------ |
| `tenant` | one school | set        | school admin   | yes                |

Every master is **tenant-owned**. There is no platform-wide global library.
`schoolId` is always derived from the authenticated request (`req.tenantId`);
a payload can never override it. Subjects are tenant masters like every other
kind — the legacy `scope` field on `SchoolSubject` is retained only so
pre-migration rows keep a compatible shape; a tenant filter hides them and no
new `scope:"global"` row is ever created.

### 2. Lifecycle field

| Convention                 | Models               | Inactive value |
| -------------------------- | -------------------- | -------------- |
| `active: Boolean`          | exam-types, classes, sections, time-slots, rooms | `active: false` |
| `status: "active"/"inactive"` | subjects            | `status: "inactive"` |

`kindConfig.lifecycle` declares which field drives the on/off state
(defaults to `{ field: "active", active: true, inactive: false }`).

- `list` filters to active rows.
- `getById` is NOT lifecycle-filtered: it keeps returning inactive rows so a
  historical reference (an exam/mark/timetable snapshot) always resolves.
- `create`, `update`, `deactivate`, `restore` are all tenant-scoped.

Rows are never hard-deleted; inactive rows keep their names reserved until
restored (a duplicate `create` still returns 409 while an inactive row holds
the name).

### 3. Uniqueness / duplicate detection

- `dupFilter(payload)` returns the uniqueness filter (`{ key }`,
  `{ className, key }`, or `{ normalizedName }` for subjects); a 409 is
  returned on a hit, carrying `{ existingId, name }` so the UI can select the
  existing row.
- On `update` and `restore` the same check runs with the row itself excluded.

Uniqueness is **case/whitespace-insensitive** via `normalizeKey` (lowercase +
collapse whitespace + trim), mirroring the `key`/`normalizedName` fields stored
by the models (`mkKey`).

## Seeding policy

- **Per-school defaults** (`seeds()`): provisioned lazily on the first `list`
  while the request is empty — but only when the caller has the write
  permission, so read-only roles see an honest empty state. Idempotent per
  school via a row count. Rows are always stamped with the school's `schoolId`.

The legacy platform library (`globalSeeds`) has been removed.

## Auditing

Master mutations (create/update/deactivate/restore) write audit events to the
single platform `AuditLog` collection (auth-service database) via
`config.audit({ req, action, target })`. Actions:

- `master.created`
- `master.updated`
- `master.deactivated`
- `master.restored`

Auditing is best-effort and fail-open: it never blocks the primary request,
and it is skipped entirely when `AUTH_MONGODB_URI` is not configured on the
writing service.

## Permission mapping

One `kind` registry maps to exactly two permissions:

- `readPermission` — powers `list` + `getById`.
- `writePermission` — powers `create`, `update`, `deactivate`, `restore` and
  (implicitly) triggering the lazy per-school seed.

Route files apply `requirePermission(read|write)` per route; the factory never
re-checks roles itself beyond using the write permission to decide seeding.

## API contract (adopted by academic-service)

```
GET    /api/exam-masters/:kind            -> { success, count, data }
GET    /api/exam-masters/:kind/:id        -> { success, data }
POST   /api/exam-masters/:kind            -> 201 { success, data } | 409 duplicate | 400 invalid
PATCH  /api/exam-masters/:kind/:id        -> { success, data } | 404 | 409 duplicate
PATCH  /api/exam-masters/:kind/:id/deactivate -> { success, data } | 404
PATCH  /api/exam-masters/:kind/:id/restore -> { success, data } | 404 | 409 conflict
```

Errors: 404 for unknown kind / missing row, 409 for duplicates, 400 for
validation failures (`httpError(400, ...)` from `build`).

## Adding a new master

1. Add the mongoose model that follows the scope + lifecycle-field rules above.
2. Add a `kindConfig` to the registry passed to `createMasterController`.
3. Mount the routes in the service's router bound to the right permissions.
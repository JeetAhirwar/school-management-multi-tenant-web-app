const { getPermissionsFor } = require("../utils/permissions");
const { assertAcademicRefs } = require("./assertAcademicRefs");

// ---------------------------------------------------------------------------
// Platform-wide master-data factory.
//
// A master is a small, tenant-scoped catalog the platform lets an admin fill
// (exam types, classes, sections, subjects, time slots, rooms, ...). This
// module provides the CRUD skeleton so every service exposes identical
// semantics instead of re-implementing tenancy, duplicate detection and
// seed-on-empty per service.
//
// Every master row is owned by exactly one school (schoolId set from the auth
// context on every create; never accepted from the request body). There are no
// platform-wide global masters. See README.md in this folder for the
// classification rules.
// ---------------------------------------------------------------------------

// Matches academic-service models' storage convention: lowercase, collapse
// whitespace, trim. Kept here so custom dup/seeds logic stays consistent.
const clean = (value) => String(value || "").trim();

const normalizeKey = (name) => clean(name).toLowerCase().replace(/\s+/g, " ").trim();

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Lifecycle config: most masters use active:true/false; some (SchoolSubject)
// use a status enum with "active"/"inactive".
const DEFAULT_LIFECYCLE = { field: "active", active: true, inactive: false };
const lifecycleOf = (ctx) => ctx.lifecycle || DEFAULT_LIFECYCLE;

// Builds { list, getById, create, update, deactivate, restore } for a kind registry.
//
// config = {
//   kinds: { kind: kindConfig, ... },  // required
//   readPermission, writePermission,   // required permission strings
//   audit({ req, action, target })    // optional, best-effort lifecycle hook
// }
//
// kindConfig = {
//   label: string,                          // human label for messages
//   model: Model,                           // mongoose model
//   sort: object,                           // list sort
//   build(payload) -> doc fields,           // validate + shape (throw httpError(400))
//   dupFilter(payload) -> filter,           // duplicate search (excludes _id on update)
//   seeds() -> rows,                        // per-school defaults (seed on empty list)
//   lifecycle: { field, active, inactive }, // lifecycle field contract
//   defaults() -> extra fields,             // e.g. legacy scope:"tenant"
// }
// ---------------------------------------------------------------------------
function createMasterController(config) {
  const { kinds, readPermission, writePermission } = config;

  const canWrite = (user) => getPermissionsFor(user).includes(writePermission);

  // Best-effort audit of successful mutations; never fails the primary request.
  async function recordAudit(ctx, req, action, target) {
    try {
      if (config.audit) await config.audit({ req, action, target });
    } catch (err) {
      console.error(`[master] audit (${action}) failed:`, err.message);
    }
  }

  // Tenant scope is always derived from the authenticated request; a caller can
  // never target another school by passing a schoolId/tenantId in the payload.
  const scoped = (req) => ({
    schoolId: req.tenantId,
    tenantId: req.tenantId,
    createdBy: req.user?._id || req.user?.id || null,
  });

  async function seedDefaults(ctx, schoolId) {
    const docs = await ctx.model.countDocuments({ schoolId });
    if (docs > 0) return false;
    const rows = (ctx.seeds ? ctx.seeds() : []).map((row) => ({
      ...row,
      schoolId,
      tenantId: schoolId,
    }));
    if (rows.length) {
      try {
        await ctx.model.insertMany(rows);
      } catch (err) {
        // Concurrent first-list race: another request seeded the same rows —
        // the unique index did its job; the loser just re-reads below.
        if (!err || err.code !== 11000) throw err;
      }
    }
    return true;
  }

  // Returns the conflicting row or null. Used by create/update/restore so a
  // deactivated row still reserves its name until it is restored.
  async function findDuplicate(ctx, req, dupFilter, excludeId) {
    const query = { schoolId: req.tenantId, ...dupFilter };
    if (excludeId) query._id = { $ne: excludeId };
    return ctx.model.findOne(query).lean();
  }

  async function list(req, res, next) {
    try {
      const ctx = kinds[req.params.kind];
      if (!ctx) return res.status(404).json({ success: false, message: "Unknown master type" });

      const lc = lifecycleOf(ctx);
      let docs = await ctx.model.find({ schoolId: req.tenantId, [lc.field]: lc.active }).sort(ctx.sort).lean();
      if (docs.length === 0 && canWrite(req.user) && (await seedDefaults(ctx, req.tenantId))) {
        docs = await ctx.model.find({ schoolId: req.tenantId, [lc.field]: lc.active }).sort(ctx.sort).lean();
      }
      res.json({ success: true, count: docs.length, data: docs });
    } catch (err) {
      next(err);
    }
  }

  async function getById(req, res, next) {
    try {
      const ctx = kinds[req.params.kind];
      if (!ctx) return res.status(404).json({ success: false, message: "Unknown master type" });

      // getById is intentionally not lifecycle-filtered: inactive rows stay
      // visible to anyone holding a historical reference (snapshot strings and
      // ids in exams/marks/timetables keep resolving).
      const doc = await ctx.model.findOne({ _id: req.params.id, schoolId: req.tenantId }).lean();
      if (!doc) return res.status(404).json({ success: false, message: `${ctx.label} not found` });
      res.json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  }

  async function create(req, res, next) {
    try {
      const ctx = kinds[req.params.kind];
      if (!ctx) return res.status(404).json({ success: false, message: "Unknown master type" });

      const payload = ctx.build(req.body || {});
      const dupFilter = ctx.dupFilter ? ctx.dupFilter(payload) : null;
      if (dupFilter) {
        const existing = await findDuplicate(ctx, req, dupFilter);
        if (existing) {
          return res.status(409).json({
            success: false,
            message: `${ctx.label} "${payload.name || payload.label}" already exists for this school`,
            data: { existingId: existing._id, name: payload.name || payload.label },
          });
        }
      }

      const doc = await ctx.model.create({
        ...(ctx.defaults ? ctx.defaults(req) : {}),
        ...payload,
        ...scoped(req),
      });
      await recordAudit(ctx, req, "created", doc);
      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      if (err && err.status) {
        return res.status(err.status).json({ success: false, message: err.message });
      }
      if (err && err.code === 11000) {
        return res.status(409).json({ success: false, message: "This value already exists for this school" });
      }
      if (err && err.name === "ValidationError") {
        return res.status(400).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  async function update(req, res, next) {
    try {
      const ctx = kinds[req.params.kind];
      if (!ctx) return res.status(404).json({ success: false, message: "Unknown master type" });

      const payload = ctx.build(req.body || {});
      const doc = await ctx.model.findOne({ _id: req.params.id, schoolId: req.tenantId }).exec();
      if (!doc) return res.status(404).json({ success: false, message: `${ctx.label} not found` });

      const dupFilter = ctx.dupFilter ? ctx.dupFilter(payload) : null;
      if (dupFilter) {
        const existing = await findDuplicate(ctx, req, dupFilter, doc._id);
        if (existing) {
          return res.status(409).json({
            success: false,
            message: `${ctx.label} "${payload.name || payload.label}" already exists for this school`,
            data: { existingId: existing._id, name: payload.name || payload.label },
          });
        }
      }

      // Save through the document so pre("validate") hooks (e.g. re-computing
      // SchoolSubject.normalizedName from name) and timestamps run.
      Object.assign(doc, payload);
      await doc.save();
      await recordAudit(ctx, req, "updated", doc);
      res.json({ success: true, data: doc });
    } catch (err) {
      if (err && err.status) {
        return res.status(err.status).json({ success: false, message: err.message });
      }
      if (err && err.code === 11000) {
        return res.status(409).json({ success: false, message: "This value already exists for this school" });
      }
      if (err && err.name === "ValidationError") {
        return res.status(400).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  async function deactivate(req, res, next) {
    try {
      const ctx = kinds[req.params.kind];
      if (!ctx) return res.status(404).json({ success: false, message: "Unknown master type" });

      const lc = lifecycleOf(ctx);
      const doc = await ctx.model
        .findOneAndUpdate(
          { _id: req.params.id, schoolId: req.tenantId },
          { [lc.field]: lc.inactive },
          { new: true },
        )
        .lean();
      if (!doc) return res.status(404).json({ success: false, message: `${ctx.label} not found` });
      await recordAudit(ctx, req, "deactivated", doc);
      res.json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  }

  async function restore(req, res, next) {
    try {
      const ctx = kinds[req.params.kind];
      if (!ctx) return res.status(404).json({ success: false, message: "Unknown master type" });

      const lc = lifecycleOf(ctx);
      const doc = await ctx.model.findOne({ _id: req.params.id, schoolId: req.tenantId }).exec();
      if (!doc) return res.status(404).json({ success: false, message: `${ctx.label} not found` });

      // Restoring brings the name back into the active set, so re-check it
      // would not collide with a live row.
      const dupFilter = ctx.dupFilter ? ctx.dupFilter(doc.toObject()) : null;
      if (dupFilter) {
        const existing = await findDuplicate(ctx, req, dupFilter, doc._id);
        if (existing) {
          return res.status(409).json({
            success: false,
            message: `Cannot restore ${ctx.label.toLowerCase()} "${doc.name}": it already exists for this school`,
          });
        }
      }

      doc[lc.field] = lc.active;
      await doc.save();
      await recordAudit(ctx, req, "restored", doc);
      res.json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  }

  return { list, getById, create, update, deactivate, restore };
}

module.exports = { createMasterController, httpError, clean, normalizeKey, assertAcademicRefs };
const AcademicSession = require("../models/AcademicSession");
const School = require("../models/School");
const { httpError } = require("@school-erp/shared/src/master-data");

const PICK_FIELDS = ["name", "startDate", "endDate", "metadata"];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

function toDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// "2026-04-01" -> "2027-03-31" => "2026-27" (codebase-wide 2-digit convention,
// matching academicYearService.deriveNextSession). Same calendar-year sessions
// (e.g. Jan-Dec 2026) derive to a plain 4-digit label "2026". Returns null
// when either date is invalid.
function deriveSessionName(startDate, endDate) {
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (
    Number.isNaN(s.getTime()) ||
    Number.isNaN(e.getTime()) ||
    !startDate ||
    !endDate
  ) {
    return null;
  }
  const y1 = s.getFullYear();
  const y2 = e.getFullYear();
  return y2 === y1 ? `${y1}` : `${y1}-${String(y2 % 100).padStart(2, "0")}`;
}

// Half-open interval [start, end): a session ends the moment the next begins,
// so back-to-back sessions like 2026-04-01..2027-03-31 and
// 2027-04-01..2028-03-31 are NOT considered overlapping.
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

async function assertUniqueName(schoolId, name, excludeId) {
  const query = { schoolId, name };
  if (excludeId) query._id = { $ne: excludeId };
  const clash = await AcademicSession.findOne(query).lean();
  if (clash) throw httpError(409, `Academic session "${name}" already exists for this school`);
}

async function assertNoOverlap(schoolId, startDate, endDate, excludeId) {
  const query = { schoolId };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await AcademicSession.find(query).lean();
  const clash = existing.find((s) =>
    rangesOverlap(startDate, endDate, s.startDate, s.endDate),
  );
  if (clash) {
    throw httpError(
      409,
      `Academic session "${clash.name}" (${clash.startDate.toISOString().slice(0, 10)} to ${clash.endDate.toISOString().slice(0, 10)}) overlaps with the requested dates`,
    );
  }
}

const listSessions = async (req, res) => {
  try {
    const data = await AcademicSession.find({ schoolId: req.tenantId })
      .sort({ startDate: 1 })
      .lean();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Single source of truth for "which session is live right now". Returns
// null when no session is current yet (school has no live session).
const getCurrentSession = async (req, res) => {
  try {
    const session = await AcademicSession.findOne({
      schoolId: req.tenantId,
      isCurrent: true,
    }).lean();
    res.json({ success: true, data: session || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSessionById = async (req, res) => {
  try {
    const session = await AcademicSession.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    }).lean();
    if (!session) return res.status(404).json({ success: false, message: "Academic session not found" });
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Sessions are never hard-deleted once activated/ended or once their start
// date has passed - historical records (fee structures, teacher assignments,
// marks, report cards) reference them. Only future, never-activated sessions
// may be removed.
const deleteSession = async (req, res) => {
  try {
    const session = await AcademicSession.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!session) return res.status(404).json({ success: false, message: "Academic session not found" });

    if (session.isCurrent || session.status !== "planned") {
      throw httpError(
        409,
        "This session is protected: activated or ended sessions cannot be deleted because historical records may reference them",
      );
    }
    const today = startOfToday().getTime();
    if (session.startDate && session.startDate.getTime() <= today) {
      throw httpError(
        409,
        "This session has already started and cannot be deleted; it remains queryable as part of the academic history",
      );
    }

    await AcademicSession.deleteOne({ _id: session._id });
    res.json({ success: true, message: "Academic session deleted" });
  } catch (err) {
    res.status(err.status || 403).json({ success: false, message: err.message });
  }
};

// Compact current-session summary used by login / me / school-profile payloads
// so every surface can render the live session without an extra round-trip.
async function resolveCurrentSessionInfo(schoolId) {
  const session = await AcademicSession.findOne({
    schoolId,
    isCurrent: true,
  }).lean();
  if (!session) return null;
  return {
    name: session.name,
    startDate: session.startDate,
    endDate: session.endDate,
  };
}

const createSession = async (req, res) => {
  try {
    const body = pick(req.body, PICK_FIELDS);
    const startDate = toDate(body.startDate);
    const endDate = toDate(body.endDate);

    if (!startDate || !endDate) throw httpError(400, "startDate and endDate are required");
    if (endDate.getTime() <= startDate.getTime()) {
      throw httpError(400, "endDate must be after startDate");
    }

    // Name is derived from the dates by default (e.g. 01 Apr 2026 - 31 Mar 2027
    // -> "2026-27"); an explicitly typed name is only honored while it matches
    // a plausible calendar label.
    const name =
      String(body.name || "").trim() ||
      deriveSessionName(startDate, endDate) ||
      "";

    if (!name) throw httpError(400, "Session name is required (e.g. 2026-27)");

    await assertUniqueName(req.tenantId, name);
    await assertNoOverlap(req.tenantId, startDate, endDate);

    const existingCount = await AcademicSession.countDocuments({ schoolId: req.tenantId });
    // First session for a school becomes the current session automatically
    // (matches the legacy School.session bootstrap when it exists and is live).
    const isFirst = existingCount === 0;
    const isLive = endDate.getTime() >= startOfToday().getTime();

    const metadata =
      body.metadata && typeof body.metadata === "object" ? body.metadata : {};

    const session = await AcademicSession.create({
      schoolId: req.tenantId,
      name,
      startDate,
      endDate,
      metadata,
      status: isFirst && isLive ? "active" : "planned",
      isCurrent: isFirst && isLive,
    });

    if (session.isCurrent) {
      await School.updateOne({ _id: req.tenantId }, { $set: { session: session.name } });
    }
    // Explicit session create = the admin engaged with the academic calendar,
    // so the post-onboarding "confirm academic configuration" prompt is cleared.
    await School.updateOne({ _id: req.tenantId }, { $set: { academicConfigConfirmed: true } });

    res.status(201).json({ success: true, data: session });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

const updateSession = async (req, res) => {
  try {
    const session = await AcademicSession.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!session) return res.status(404).json({ success: false, message: "Academic session not found" });

    // Planned and active sessions are editable so a school can fix its
    // calendar (start/end dates) even after going live. Ended sessions are
    // immutable history. Renaming is only allowed while planned: once a session
    // is live its name is referenced by fee structures, teacher assignments,
    // exams and marks across services — changing it would orphan those records.
    if (session.status === "ended") {
      throw httpError(400, "Ended sessions cannot be edited");
    }

    const body = pick(req.body, PICK_FIELDS);
    const rawName = body.name !== undefined ? String(body.name || "").trim() : null;
    const rawStart = body.startDate !== undefined ? body.startDate : session.startDate;
    const rawEnd = body.endDate !== undefined ? body.endDate : session.endDate;
    const startDate = toDate(rawStart);
    const endDate = toDate(rawEnd);

    let name;
    if (rawName !== null && rawName !== "" && session.status === "active" && rawName !== session.name) {
      throw httpError(
        400,
        "The current session's name is locked once live because fee structures, teacher assignments and marks reference it. Adjust the start/end dates instead — the label is derived from them.",
      );
    }
    if (rawName !== null && rawName !== "") {
      name = rawName;
    } else if (session.status === "active") {
      // Dates-only edit on a live session — keep identity, never auto-rename
      // (a date shift like Jan-Dec would otherwise derive a new label and
      // orphan fee/assignment/exam references).
      name = session.name;
    } else {
      name = deriveSessionName(startDate, endDate) || session.name;
    }

    if (!name) throw httpError(400, "Session name is required");
    if (!startDate || !endDate) throw httpError(400, "startDate and endDate are required");
    if (endDate.getTime() <= startDate.getTime()) {
      throw httpError(400, "endDate must be after startDate");
    }

    await assertUniqueName(req.tenantId, name, session._id);
    await assertNoOverlap(req.tenantId, startDate, endDate, session._id);

    session.name = name;
    session.startDate = startDate;
    session.endDate = endDate;
    if (body.metadata !== undefined) {
      session.metadata = typeof body.metadata === "object" ? body.metadata : session.metadata;
    }
    await session.save();
    await School.updateOne({ _id: req.tenantId }, { $set: { academicConfigConfirmed: true } });
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

// Controlled current-session transition. The session being activated must be
// live (end date not yet passed). The previously current session is moved to
// "ended" so there is always exactly one current session per school. Keeps the
// legacy School.session string in sync so the existing fee/assignment/login
// surfaces keep showing the same value.
const activateSession = async (req, res) => {
  try {
    const session = await AcademicSession.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!session) return res.status(404).json({ success: false, message: "Academic session not found" });

    if (session.status === "ended") {
      throw httpError(400, "An ended session cannot be made current again");
    }
    if (!session.endDate || session.endDate.getTime() < startOfToday().getTime()) {
      throw httpError(400, "This session has already ended and cannot be made the current session");
    }

    await AcademicSession.updateMany(
      { schoolId: req.tenantId, _id: { $ne: session._id }, isCurrent: true },
      { $set: { isCurrent: false, status: "ended" } },
    );

    session.isCurrent = true;
    session.status = "active";
    await session.save();
    await School.updateOne({ _id: req.tenantId }, { $set: { session: session.name } });

    res.json({ success: true, data: session });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

const endSession = async (req, res) => {
  try {
    const session = await AcademicSession.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    });
    if (!session) return res.status(404).json({ success: false, message: "Academic session not found" });

    if (session.status === "ended") {
      throw httpError(400, "This session is already ended");
    }

    session.status = "ended";
    session.isCurrent = false;
    await session.save();
    // School.session is intentionally left as the last-known current session so
    // the legacy display value stays meaningful; admins can activate another
    // session to move the school forward.
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
};

module.exports = {
  listSessions,
  getCurrentSession,
  getSessionById,
  // [internal] Resolve a session label to its calendar window (report-card
  // attendance scoping in the academic service). Guarded by the internal key
  // via /api/auth/internal; schoolId comes from the query, not a token.
  getSessionWindow: async (req, res) => {
    try {
      const { schoolId, name } = req.query;
      if (!schoolId || !String(name || "").trim()) {
        return res.status(400).json({ success: false, message: "schoolId and name are required" });
      }
      const session = await AcademicSession.findOne({
        schoolId,
        name: String(name).trim(),
      }).lean();
      if (!session) return res.status(404).json({ success: false, message: "Academic session not found" });
      res.json({
        success: true,
        data: {
          name: session.name,
          startDate: session.startDate,
          endDate: session.endDate,
          isCurrent: !!session.isCurrent,
          status: session.status,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  resolveCurrentSessionInfo,
  deriveSessionName,
  createSession,
  updateSession,
  activateSession,
  endSession,
  deleteSession,
};
const GradingScale = require("../models/GradingScale");
const { GRADING_PRESETS, validateScaleBands } = require("../utils/gradingPresets");

// First list per school seeds the three built-in presets (Default, CBSE,
// ICSE) with Default active. Concurrent-first-list races lose on the unique
// index and just re-read below (11000 tolerated).
async function seedPresets(schoolId) {
  const count = await GradingScale.countDocuments({ schoolId });
  if (count > 0) return;
  try {
    await GradingScale.insertMany(
      GRADING_PRESETS.map((p, i) => ({
        schoolId,
        name: p.name,
        key: p.key,
        system: p.system,
        bands: p.bands,
        passPct: p.passPct,
        isDefault: i === 0,
        active: true,
        createdBy: "",
      }))
    );
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
  }
}

const listScales = async (req, res) => {
  try {
    await seedPresets(req.tenantId);
    const data = await GradingScale.find({ schoolId: req.tenantId })
      .sort({ isDefault: -1, system: 1, name: 1 })
      .lean();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// The active scale for grade computation (fallback shape when nothing is
// configured yet — resolves the same way resolveScale does server-side).
const getActiveScale = async (req, res) => {
  try {
    const row = await GradingScale.findOne({
      schoolId: req.tenantId,
      isDefault: true,
      active: true,
    }).lean();
    if (row) return res.json({ success: true, data: row });
    const fallback = GRADING_PRESETS.find((p) => p.key === "default");
    return res.json({
      success: true,
      data: {
        name: fallback.name,
        system: "default",
        bands: fallback.bands,
        passPct: fallback.passPct,
        isDefault: true,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createScale = async (req, res) => {
  try {
    const { name = "", bands, passPct } = req.body || {};
    if (!String(name).trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }
    const bandErr = validateScaleBands(bands);
    if (bandErr) return res.status(400).json({ success: false, message: bandErr });
    const pass = passPct == null ? 33 : Number(passPct);
    if (Number.isNaN(pass) || pass < 0 || pass > 100) {
      return res.status(400).json({ success: false, message: "passPct must be between 0 and 100" });
    }
    const doc = await GradingScale.create({
      schoolId: req.tenantId,
      name: String(name).trim(),
      system: "custom",
      bands,
      passPct: pass,
      isDefault: false,
      active: true,
      createdBy: req.user.refId ? String(req.user.refId) : "",
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err && err.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "A grading scale with this name already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const updateScale = async (req, res) => {
  try {
    const scale = await GradingScale.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!scale) {
      return res.status(404).json({ success: false, message: "Grading scale not found" });
    }
    const { name, bands, passPct, active } = req.body || {};
    if (bands !== undefined) {
      const bandErr = validateScaleBands(bands);
      if (bandErr) return res.status(400).json({ success: false, message: bandErr });
      scale.bands = bands;
    }
    if (passPct !== undefined) {
      const pass = Number(passPct);
      if (Number.isNaN(pass) || pass < 0 || pass > 100) {
        return res.status(400).json({ success: false, message: "passPct must be between 0 and 100" });
      }
      scale.passPct = pass;
    }
    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ success: false, message: "name cannot be empty" });
      }
      scale.name = String(name).trim();
    }
    if (active !== undefined) {
      const next = Boolean(active);
      if (!next && scale.isDefault) {
        return res.status(400).json({
          success: false,
          message: "The active scale cannot be deactivated — activate another scale first",
        });
      }
      scale.active = next;
    }
    await scale.save();
    res.json({ success: true, data: scale });
  } catch (err) {
    if (err && err.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "A grading scale with this name already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

// Switch the school's active scale. Clearing the old default first, then
// claiming the new one — the partial unique index {schoolId, isDefault} makes
// concurrent switches safe (loser gets 409, nothing half-applies).
const activateScale = async (req, res) => {
  try {
    const scale = await GradingScale.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!scale) {
      return res.status(404).json({ success: false, message: "Grading scale not found" });
    }
    if (!scale.active) {
      return res.status(400).json({ success: false, message: "Restore this scale before activating it" });
    }
    if (scale.isDefault) return res.json({ success: true, data: scale });
    try {
      await GradingScale.updateMany(
        { schoolId: req.tenantId, _id: { $ne: scale._id }, isDefault: true },
        { $set: { isDefault: false } }
      );
      await GradingScale.updateOne({ _id: scale._id }, { $set: { isDefault: true } });
    } catch (err) {
      if (err && err.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Another scale was activated concurrently — retry" });
      }
      throw err;
    }
    const fresh = await GradingScale.findOne({ _id: scale._id }).lean();
    res.json({ success: true, data: fresh });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteScale = async (req, res) => {
  try {
    const scale = await GradingScale.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!scale) {
      return res.status(404).json({ success: false, message: "Grading scale not found" });
    }
    if (scale.isDefault) {
      return res.status(400).json({
        success: false,
        message: "The active scale cannot be deleted — activate another scale first",
      });
    }
    await scale.deleteOne();
    res.json({ success: true, message: "Grading scale removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { listScales, getActiveScale, createScale, updateScale, activateScale, deleteScale };

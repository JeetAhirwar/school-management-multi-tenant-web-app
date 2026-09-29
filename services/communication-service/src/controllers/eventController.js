const Event = require("../models/Event");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");
const { assertAllowedUpload } = require("@school-erp/shared/src/utils/uploads");

// Mass-assignment guard: only these fields may be set from the request body
// (schoolId / createdBy / timestamps stay server-owned).
const EVENT_FIELDS = [
  "title", "description", "category", "time", "image", "date", "venue", "audience",
];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const createEvent = async (req, res) => {
  try {
    const event = await Event.create({ ...pick(req.body, EVENT_FIELDS), schoolId: req.tenantId, createdBy: req.user.name });
    res.status(201).json({ success: true, data: event });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getEvents = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId, $or: [{ audience: req.user.role }, { audience: "all" }] };
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      Event.find(filter).sort({ date: 1 }).skip(skip).limit(limit),
      Event.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateEvent = async (req, res) => {
  try {
    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      pick(req.body, EVENT_FIELDS),
      { new: true, runValidators: true },
    );
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.json({ success: true, data: event });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.json({ success: true, message: "Event deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const uploadEventImage = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ success: false, message: "Image file is required" });
    const uploadErr = assertAllowedUpload(req.file);
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr });
    }
    const imagekit = require("@school-erp/shared/src/config/imagekit");
    if (!imagekit) {
      return res
        .status(503)
        .json({ success: false, message: "Image provider is not configured" });
    }
    const uploaded = await imagekit.upload({
      file: req.file.buffer.toString("base64"),
      fileName: `event-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-")}`,
      folder: "/school-erp/events",
      useUniqueFileName: true,
    });
    res
      .status(201)
      .json({
        success: true,
        data: { url: uploaded.url, fileId: uploaded.fileId },
      });
  } catch (err) {
    res.status(502).json({ success: false, message: err?.message || "Image upload failed" });
  }
};

module.exports = { createEvent, getEvents, updateEvent, deleteEvent, uploadEventImage };

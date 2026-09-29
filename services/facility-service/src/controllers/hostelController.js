const Hostel = require("../models/Hostel");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Mass-assignment guard: only these fields may be set from the request body.
const HOSTEL_FIELDS = [
  "roomNo", "block", "floor", "wing", "capacity", "occupants", "warden",
];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const createRoom = async (req, res) => {
  try {
    const room = await Hostel.create({ ...pick(req.body, HOSTEL_FIELDS), schoolId: req.tenantId });
    res.status(201).json({ success: true, data: room });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getRooms = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    if (req.user.role === "student") {
      // Students may only see rooms they are allotted in; the admission number
      // is always taken from the token, never from a query parameter.
      filter.occupants = req.user.refId;
    } else if (req.query.studentId) {
      filter.occupants = req.query.studentId;
    }
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      Hostel.find(filter).skip(skip).limit(limit),
      Hostel.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const allotRoom = async (req, res) => {
  try {
    const { studentId } = req.body;
    const room = await Hostel.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    if (room.occupants.length >= room.capacity) {
      return res.status(400).json({ success: false, message: "Room is full" });
    }
    if (!room.occupants.includes(studentId)) room.occupants.push(studentId);
    await room.save();
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const vacateRoom = async (req, res) => {
  try {
    const room = await Hostel.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { $pull: { occupants: req.body.studentId } },
      { new: true },
    );
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const room = await Hostel.findOne({ _id: req.params.id, schoolId: req.tenantId });
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    if (room.occupants.length) {
      return res.status(400).json({ success: false, message: "Move out occupants first" });
    }
    await room.deleteOne();
    res.json({ success: true, message: "Room deleted" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { createRoom, getRooms, allotRoom, vacateRoom, deleteRoom };

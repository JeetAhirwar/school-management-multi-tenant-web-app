const BusRoute = require("../models/BusRoute");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Mass-assignment guard: only these fields may be set from the request body.
const ROUTE_FIELDS = [
  "routeNo", "driverName", "driverContact", "vehicleNo", "stops",
  "assignedStudents", "currentLocation",
];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const createRoute = async (req, res) => {
  try {
    const route = await BusRoute.create({ ...pick(req.body, ROUTE_FIELDS), schoolId: req.tenantId });
    res.status(201).json({ success: true, data: route });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getRoutes = async (req, res) => {
  try {
    const { studentId } = req.query;
    const filter = { schoolId: req.tenantId };
    if (studentId) filter.assignedStudents = studentId;
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      BusRoute.find(filter).skip(skip).limit(limit),
      BusRoute.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const route = await BusRoute.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { currentLocation: { lat, lng, updatedAt: new Date() } },
      { new: true },
    );
    if (!route) return res.status(404).json({ success: false, message: "Route not found" });
    res.json({ success: true, data: route });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const assignStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const route = await BusRoute.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { $addToSet: { assignedStudents: studentId } },
      { new: true },
    );
    if (!route) return res.status(404).json({ success: false, message: "Route not found" });
    res.json({ success: true, data: route });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { createRoute, getRoutes, updateLocation, assignStudent };

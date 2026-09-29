const Syllabus = require("../models/Syllabus");

const getSyllabus = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    if (req.query.class) filter.class = req.query.class;
    if (req.query.subject) filter.subject = req.query.subject;
    if (req.query.term) filter.term = req.query.term;
    const data = await Syllabus.find(filter).sort({ class: 1, subject: 1 });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createSyllabus = async (req, res) => {
  try {
    const { class: cls, subject, term, topics, totalHours } = req.body;
    if (!cls || !subject) {
      return res.status(400).json({ success: false, message: "class and subject are required" });
    }
    const syllabus = await Syllabus.create({
      class: cls, subject, term, topics, totalHours,
      schoolId: req.tenantId,
    });
    res.status(201).json({ success: true, data: syllabus });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Mass-assignment guard: only these fields may be set from the request body.
// schoolId (tenant) and _id are deliberately excluded so a client can never
// move a syllabus to another school.
const SYLLABUS_FIELDS = ["class", "subject", "term", "topics", "totalHours"];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const updateSyllabus = async (req, res) => {
  try {
    const syllabus = await Syllabus.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      pick(req.body, SYLLABUS_FIELDS),
      { new: true }
    );
    if (!syllabus) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: syllabus });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteSyllabus = async (req, res) => {
  try {
    const syllabus = await Syllabus.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!syllabus) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getSyllabus, createSyllabus, updateSyllabus, deleteSyllabus };

const BehaviorRecord = require("../models/BehaviorRecord");

const createRecord = async (req, res) => {
  try {
    const { studentId, class: cls, section, date, type, title, description, severity, actionTaken, witnesses, followUpRequired, followUpNotes } = req.body;
    if (!studentId || !cls || !title || !date) {
      return res.status(400).json({ success: false, message: "studentId, class, title, and date are required" });
    }

    // Teachers must be scoped to the class.
    if (req.user.role === "teacher" && req.teacherScope) {
      if (!req.teacherScope.has(cls, section)) {
        return res.status(403).json({ success: false, message: "Access denied — class is not in your assigned classes" });
      }
    }

    const record = await BehaviorRecord.create({
      schoolId: req.tenantId,
      studentId,
      class: cls,
      section,
      date,
      type,
      title,
      description,
      severity,
      actionTaken,
      witnesses,
      followUpRequired,
      followUpNotes,
      reportedBy: req.user.refId || req.user.id,
      reportedByRole: req.user.role,
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const listRecords = async (req, res) => {
  try {
    const { studentId, class: cls, section, type, severity, from, to, page = 1, limit = 50 } = req.query;
    const filter = { schoolId: req.tenantId };

    if (studentId) filter.studentId = studentId;
    if (cls) filter.class = cls;
    if (section) filter.section = section;
    if (type) filter.type = type;
    if (severity) filter.severity = severity;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }

    // Teachers scoped to their classes.
    if (req.user.role === "teacher" && req.teacherScope) {
      const scopes = req.teacherScope.allScopes || [];
      filter.$or = scopes.map((s) => ({ class: s.class, section: s.section || null }));
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      BehaviorRecord.find(filter).sort({ date: -1 }).skip(skip).limit(limitNum).lean(),
      BehaviorRecord.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count: data.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getRecord = async (req, res) => {
  try {
    const record = await BehaviorRecord.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
      // Students may only read their own conduct history — ownership guard
      // for the :id route (the list route is scoped by scopeStudentQuery).
      ...(req.user.role === "student" ? { studentId: req.user.refId } : {}),
    }).lean();
    if (!record) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateRecord = async (req, res) => {
  try {
    const existing = await BehaviorRecord.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }
    if (req.user.role === "teacher" && req.teacherScope) {
      if (!req.teacherScope.has(existing.class, existing.section)) {
        return res.status(403).json({ success: false, message: "Access denied — record is not in your assigned classes" });
      }
    }
    const record = await BehaviorRecord.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteRecord = async (req, res) => {
  try {
    const existing = await BehaviorRecord.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }
    if (req.user.role === "teacher" && req.teacherScope) {
      if (!req.teacherScope.has(existing.class, existing.section)) {
        return res.status(403).json({ success: false, message: "Access denied — record is not in your assigned classes" });
      }
    }
    await BehaviorRecord.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    res.json({ success: true, message: "Record deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createRecord, listRecords, getRecord, updateRecord, deleteRecord };

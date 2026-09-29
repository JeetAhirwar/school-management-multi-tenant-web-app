const Achievement = require("../models/Achievement");

const createAchievement = async (req, res) => {
  try {
    const { studentId, class: cls, section, title, category, description, date, certificateUrl, year } = req.body;
    if (!studentId || !title || !date) {
      return res.status(400).json({ success: false, message: "studentId, title, and date are required" });
    }

    // Teachers must be scoped to the class.
    if (req.user.role === "teacher" && req.teacherScope && cls) {
      if (!req.teacherScope.has(cls, section)) {
        return res.status(403).json({ success: false, message: "Access denied — class is not in your assigned classes" });
      }
    }

    const record = await Achievement.create({
      schoolId: req.tenantId,
      studentId,
      class: cls,
      section,
      title,
      category,
      description,
      date,
      certificateUrl,
      year,
      awardedBy: req.user.refId || req.user.id,
      awardedByRole: req.user.role,
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const listAchievements = async (req, res) => {
  try {
    const { studentId, class: cls, section, category, year, page = 1, limit = 50 } = req.query;
    const filter = { schoolId: req.tenantId };

    if (studentId) filter.studentId = studentId;
    if (cls) filter.class = cls;
    if (section) filter.section = section;
    if (category) filter.category = category;
    if (year) filter.year = parseInt(year);

    // Teachers scoped to their classes.
    if (req.user.role === "teacher" && req.teacherScope) {
      const scopes = req.teacherScope.allScopes || [];
      filter.$or = scopes.map((s) => ({ class: s.class, section: s.section || null }));
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Achievement.find(filter).sort({ date: -1 }).skip(skip).limit(limitNum).lean(),
      Achievement.countDocuments(filter),
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

const getAchievement = async (req, res) => {
  try {
    const record = await Achievement.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
      // Students may only read their own achievements — ownership guard for
      // the :id route (the list route is scoped by scopeStudentQuery).
      ...(req.user.role === "student" ? { studentId: req.user.refId } : {}),
    }).lean();
    if (!record) {
      return res.status(404).json({ success: false, message: "Achievement not found" });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateAchievement = async (req, res) => {
  try {
    const existing = await Achievement.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Achievement not found" });
    }
    if (req.user.role === "teacher" && req.teacherScope) {
      if (!req.teacherScope.has(existing.class, existing.section)) {
        return res.status(403).json({ success: false, message: "Access denied — achievement is not in your assigned classes" });
      }
    }
    const record = await Achievement.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteAchievement = async (req, res) => {
  try {
    const existing = await Achievement.findOne({
      _id: req.params.id,
      schoolId: req.tenantId,
    }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Achievement not found" });
    }
    if (req.user.role === "teacher" && req.teacherScope) {
      if (!req.teacherScope.has(existing.class, existing.section)) {
        return res.status(403).json({ success: false, message: "Access denied — achievement is not in your assigned classes" });
      }
    }
    await Achievement.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    res.json({ success: true, message: "Achievement deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createAchievement, listAchievements, getAchievement, updateAchievement, deleteAchievement };

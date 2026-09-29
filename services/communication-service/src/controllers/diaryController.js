const DiaryEntry = require("../models/DiaryEntry");
const { resolveAudienceUserIds, insertFanout, visibleClassTagsFor, classTagFilters } = require("../services/audience");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Mass-assignment guard (schoolId / postedBy / date stay server-owned).
const DIARY_FIELDS = ["title", "body", "class", "section"];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const createDiary = async (req, res) => {
  try {
    const entry = await DiaryEntry.create({
      ...pick(req.body, DIARY_FIELDS),
      schoolId: req.tenantId,
      postedBy: req.user.name,
    });
    // Tell that class's students + parents there is a new diary entry.
    // Fire-and-forget: a notification failure never blocks the write.
    resolveAudienceUserIds({
      schoolId: req.tenantId,
      audience: ["student", "parent"],
      classTags: [`${entry.class}-${entry.section}`],
    })
      .then((userIds) =>
        insertFanout(req.tenantId, userIds, {
          title: "New Diary Entry",
          message: entry.title,
          kind: "diary",
          link: "/diary",
        })
      )
      .catch((err) => console.error("[diary fanout skipped]", err.message));
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Class-scoped list: teachers/admins/staff see the school's diary (optionally
// narrowed with ?class=&section=); students/parents only see entries for their
// own class-section(s).
const listDiary = async (req, res) => {
  try {
    const filter = { schoolId: req.tenantId };
    const ownTags = await visibleClassTagsFor({ tenantId: req.tenantId, user: req.user });
    if (ownTags !== null) {
      const tags = [...ownTags];
      if (tags.length === 0) {
        return res.json({ success: true, count: 0, total: 0, ...pageInfo(0, 1, 10), data: [] });
      }
      filter.$or = classTagFilters(tags);
    } else if (req.query.class) {
      filter.class = String(req.query.class);
      if (req.query.section) filter.section = String(req.query.section);
    }
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      DiaryEntry.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
      DiaryEntry.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateDiary = async (req, res) => {
  try {
    const updates = pick(req.body, DIARY_FIELDS);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }
    const entry = await DiaryEntry.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      { $set: updates },
      { new: true, runValidators: true },
    );
    if (!entry) return res.status(404).json({ success: false, message: "Diary entry not found" });
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteDiary = async (req, res) => {
  try {
    const entry = await DiaryEntry.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!entry) return res.status(404).json({ success: false, message: "Diary entry not found" });
    res.json({ success: true, message: "Diary entry deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createDiary, listDiary, updateDiary, deleteDiary };

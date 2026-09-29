const InventoryItem = require("../models/InventoryItem");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Mass-assignment guard: only these fields may be set from the request body.
const ITEM_FIELDS = [
  "itemName", "category", "quantity", "reorderLevel", "unit", "supplier", "purchaseDate",
];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const addItem = async (req, res) => {
  try {
    const item = await InventoryItem.create({ ...pick(req.body, ITEM_FIELDS), schoolId: req.tenantId });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getItems = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { schoolId: req.tenantId };
    if (category) filter.category = category;
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      InventoryItem.find(filter).skip(skip).limit(limit),
      InventoryItem.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateItem = async (req, res) => {
  try {
    const item = await InventoryItem.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      pick(req.body, ITEM_FIELDS),
      { new: true },
    );
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    res.json({ success: true, data: item });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteItem = async (req, res) => {
  try {
    const item = await InventoryItem.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    res.json({ success: true, message: "Item removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { addItem, getItems, updateItem, deleteItem };

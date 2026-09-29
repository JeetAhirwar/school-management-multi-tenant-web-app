const Book = require("../models/Book");
const { paginate, pageInfo } = require("@school-erp/shared/src/utils/pagination");

// Escapes regex metacharacters in user search terms to prevent regex
// injection / ReDoS-style patterns; length-capped to bound scan cost.
const escapeRegex = (term) =>
  String(term).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Mass-assignment guard: only these fields may be set from the request body.
const BOOK_FIELDS = ["isbn", "title", "author", "category", "totalCopies"];
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const addBook = async (req, res) => {
  try {
    const { totalCopies = 1 } = req.body;
    const book = await Book.create({
      ...pick(req.body, BOOK_FIELDS),
      schoolId: req.tenantId,
      availableCopies: totalCopies,
    });
    res.status(201).json({ success: true, data: book });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const getBooks = async (req, res) => {
  try {
    const { category, search } = req.query;
    const filter = { schoolId: req.tenantId };
    if (category) filter.category = category;
    if (search) filter.title = { $regex: escapeRegex(search), $options: "i" };
    const { page, limit, skip } = paginate(req.query);
    const [data, total] = await Promise.all([
      Book.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Book.countDocuments(filter),
    ]);
    res.json({ success: true, count: data.length, total, ...pageInfo(total, page, limit), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateBook = async (req, res) => {
  try {
    const book = await Book.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.tenantId },
      pick(req.body, BOOK_FIELDS),
      { new: true },
    );
    if (!book) return res.status(404).json({ success: false, message: "Book not found" });
    res.json({ success: true, data: book });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteBook = async (req, res) => {
  try {
    const book = await Book.findOneAndDelete({ _id: req.params.id, schoolId: req.tenantId });
    if (!book) return res.status(404).json({ success: false, message: "Book not found" });
    res.json({ success: true, message: "Book removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { addBook, getBooks, updateBook, deleteBook };

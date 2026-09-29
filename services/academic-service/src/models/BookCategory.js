const mongoose = require("mongoose");
const { mkKey } = require("../utils/normalize");

// @school-erp master catalog for library book categories (single-scope,
// tenant-owned). Mirrors FeeType/ExamType storage conventions so the shared
// master-data factory handles CRUD, seeds and duplicate detection uniformly.
const bookCategorySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

bookCategorySchema.pre("validate", function (next) {
  this.key = mkKey(this.name);
  next();
});

bookCategorySchema.index({ schoolId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("BookCategory", bookCategorySchema);
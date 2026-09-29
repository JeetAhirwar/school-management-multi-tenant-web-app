const mongoose = require("mongoose");

const bookSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    isbn: { type: String, default: "", trim: true },
    title: { type: String, required: true },
    author: { type: String, required: true },
    category: { type: String },
    totalCopies: { type: Number, default: 1 },
    availableCopies: { type: Number, default: 1 },
    addedOn: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ISBN is optional. Uniqueness only applies to non-empty ISBNs so a school can
// hold many books that never had an ISBN assigned.
bookSchema.index(
  { schoolId: 1, isbn: 1 },
  {
    unique: true,
    name: "schoolId_1_isbn_unique",
    partialFilterExpression: { isbn: { $type: "string", $gt: "" } },
  }
);

module.exports = mongoose.model("Book", bookSchema);

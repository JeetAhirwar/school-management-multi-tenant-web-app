const mongoose = require("mongoose");

const issueSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    borrowerId: { type: String, required: true }, // studentId or staffId
    borrowerType: { type: String, enum: ["student", "staff"], required: true },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    returnDate: { type: Date },
    fine: { type: Number, default: 0 },
    status: { type: String, enum: ["Issued", "Returned", "Overdue"], default: "Issued" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("IssueRecord", issueSchema);

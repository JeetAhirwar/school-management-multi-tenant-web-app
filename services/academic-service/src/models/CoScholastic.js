const mongoose = require("mongoose");

// Co-scholastic (non-academic) assessment record — CLIENT-REQ-027. One row per
// student per session+term holds the CBSE co-scholastic areas (Work Education,
// Art Education, Health & Physical Education, plus any school-defined area)
// with the 6-point CCE grade scale and remarks. Kept out of Marks because
// these carry no marksObtained/maxMarks.
const coScholasticSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    // admissionNo — the canonical student identity used by Marks/Attendance.
    studentId: { type: String, required: true },
    session: { type: String, default: "" }, // academic year label e.g. "2026-27"
    term: { type: String, enum: ["Term 1", "Term 2", "Final"], required: true },
    class: { type: String, default: "" },
    section: { type: String, default: "" },
    areas: [
      {
        _id: false,
        area: { type: String, required: true, trim: true },
        // 6-point CCE co-scholastic scale: A1 Outstanding ... D Marginal.
        grade: {
          type: String,
          enum: ["", "A1", "A2", "B1", "B2", "C", "D"],
          default: "",
        },
        remark: { type: String, default: "" },
      },
    ],
    comments: { type: String, default: "" },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

coScholasticSchema.index(
  { schoolId: 1, studentId: 1, session: 1, term: 1 },
  { unique: true }
);

module.exports = mongoose.model("CoScholastic", coScholasticSchema);

const mongoose = require("mongoose");

const examSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    examName: { type: String, required: true }, // e.g. "Term 2 - Mid Term"
    class: { type: String, required: true },
    section: { type: String, default: "" },
    subject: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String },
    endTime: { type: String },
    room: { type: String },
    maxMarks: { type: Number, required: true },
    passingMarks: { type: Number, default: null }, // pass PERCENTAGE; null = use the school's active GradingScale passPct
    session: { type: String, index: true }, // academic year label e.g. "2026-27"
    // Typed exam kind (CLIENT-REQ-021). Legacy rows predate the field and read
    // as "other". FE-facing labels: Unit Test / FA / SA / Term / Quiz /
    // Practical / Other.
    kind: {
      type: String,
      enum: ["unit_test", "fa", "sa", "term", "quiz", "practical", "other"],
      default: "other",
      index: true,
    },
    // Which term the exam belongs to; drives the term rollup endpoint.
    term: { type: String, enum: ["", "Term 1", "Term 2", "Final"], default: "", index: true },
    // CCE round tag (CLIENT-REQ-027): set on FA/SA exams to identify which
    // Formative / Summative Assessment round the paper belongs to.
    cceTool: {
      type: String,
      enum: ["", "FA1", "FA2", "FA3", "FA4", "SA1", "SA2"],
      default: "",
      index: true,
    },
    // Result publishing state machine: draft -> reviewed -> published.
    // Students only ever see marks belonging to "published" exams.
    status: {
      type: String,
      enum: ["draft", "reviewed", "published"],
      default: "draft",
      index: true,
    },
    // Optional references to the master entities that produced the snapshot
    // strings above. Keeps the subject/exam-type/etc. reusable across modules.
    examTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "ExamType", default: null },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass", default: null },
    sectionId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolSection", default: null },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolSubject", default: null },
    timeSlotId: { type: mongoose.Schema.Types.ObjectId, ref: "TimeSlot", default: null },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Exam", examSchema);

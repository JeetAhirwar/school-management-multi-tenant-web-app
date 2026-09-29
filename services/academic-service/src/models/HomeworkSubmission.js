const mongoose = require("mongoose");

const homeworkSubmissionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    homeworkId: { type: mongoose.Schema.Types.ObjectId, ref: "Homework", required: true, index: true },
    studentId: { type: String, required: true, index: true },
    admissionNo: { type: String, required: true },
    studentName: { type: String },
    content: { type: String, trim: true, maxlength: 5000 },
    // Attachment entries are either a plain URL string (legacy) or an object
    // { fileName, fileUrl, fileId, mimeType, fileSize } produced by the upload
    // endpoint on submission.
    attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ["Submitted", "Late", "Reviewed"], default: "Submitted" },
    teacherFeedback: { type: String, trim: true, maxlength: 3000, default: null },
    gradedAt: { type: Date, default: null },
    marks: { type: Number, default: null, min: 0 },
    reviewedBy: { type: String, default: null },
  },
  { timestamps: true }
);

// A student can submit a given homework only once.
homeworkSubmissionSchema.index({ schoolId: 1, homeworkId: 1, studentId: 1 }, { unique: true });
homeworkSubmissionSchema.index({ schoolId: 1, homeworkId: 1, status: 1 });
homeworkSubmissionSchema.index({ studentId: 1, createdAt: -1 });

module.exports = mongoose.model("HomeworkSubmission", homeworkSubmissionSchema);

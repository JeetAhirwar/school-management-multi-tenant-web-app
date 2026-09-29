const mongoose = require("mongoose");

const studentHealthRecordSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: String, required: true, index: true },
    allergies: [{ type: String, trim: true }],
    chronicConditions: [{ type: String, trim: true }],
    // Vaccination records entered by the school (free-text entries like
    // "MMR — 2021-05-10"), same comma-list pattern as allergies.
    immunizations: [{ type: String, trim: true }],
    medications: [{
      name: { type: String, trim: true },
      dosage: { type: String, trim: true },
      frequency: { type: String, trim: true },
    }],
    bloodGroup: { type: String, trim: true },
    heightCm: { type: Number },
    weightKg: { type: Number },
    visionNotes: { type: String, trim: true },
    hearingNotes: { type: String, trim: true },
    emergencyMedicalContact: { type: String, trim: true },
    emergencyMedicalPhone: { type: String, trim: true },
    notes: { type: String, trim: true },
    lastUpdatedBy: { type: String },
    lastUpdatedByRole: { type: String },
  },
  { timestamps: true }
);

studentHealthRecordSchema.index({ schoolId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model("StudentHealthRecord", studentHealthRecordSchema);

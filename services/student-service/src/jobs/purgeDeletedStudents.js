// Daily retention purge for soft-deleted students (Phase 2 delete cascades).
// Hard-deletes Student rows (plus owned health records / documents and their
// remote uploads) once they have been in the trash longer than the retention
// window, and removes the linked auth-service login for each victim.
//
// Retention: STUDENT_SOFT_DELETE_RETENTION_DAYS (default 30 days).
const mongoose = require("mongoose");
const Student = require("../models/Student");
const StudentHealthRecord = require("../models/StudentHealthRecord");
const StudentDocument = require("../models/StudentDocument");
const { purgeStudentUser } = require("../utils/authCascade");

const RETENTION_DAYS = Number(process.env.STUDENT_SOFT_DELETE_RETENTION_DAYS) > 0
  ? Number(process.env.STUDENT_SOFT_DELETE_RETENTION_DAYS)
  : 30;

async function purgeDeletedStudents({ dryRun = false } = {}) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const victims = await Student.find({
    deletedAt: { $ne: null, $lte: cutoff },
  })
    .select("schoolId admissionNo name fileIds")
    .lean();

  if (!victims.length) return { purged: 0 };
  if (dryRun) return { purged: 0, wouldPurge: victims.length };

  let purged = 0;
  for (const victim of victims) {
    try {
      // 1. Health records keyed by studentId (= admissionNo) within school.
      await StudentHealthRecord.deleteMany({
        schoolId: victim.schoolId,
        studentId: victim.admissionNo,
      });
      // 2. Documents + their remote uploads (non-fatal if storage is down).
      const docs = await StudentDocument.find({
        schoolId: victim.schoolId,
        studentId: victim.admissionNo,
      })
        .select("fileId")
        .lean();
      if (docs.length) {
        await StudentDocument.deleteMany({ schoolId: victim.schoolId, studentId: victim.admissionNo });
        // Remote cleanup mirrors documentController.deleteDocument.
        try {
          const imagekit = require("@school-erp/shared/src/config/imagekit");
          for (const doc of docs) {
            if (doc.fileId && imagekit) await imagekit.deleteFile(doc.fileId);
          }
        } catch (err) {
          console.error("[purgeDeletedStudents] remote file delete skipped]", err.message);
        }
      }
      // 3. Linked auth-service login (best-effort, like every cascade hook).
      await purgeStudentUser({ schoolId: victim.schoolId, admissionNo: victim.admissionNo });
      // 4. The student row itself — the point of no return.
      await Student.deleteOne({ _id: victim._id });
      purged += 1;
      console.log(
        `[purgeDeletedStudents] purged ${victim.name || victim.admissionNo} (${victim.admissionNo}) after ${RETENTION_DAYS}d`,
      );
    } catch (err) {
      console.error(`[purgeDeletedStudents] failed for ${victim.admissionNo}:`, err.message);
    }
  }
  return { purged };
}

// Start the daily timer. Only idempotent guards: mongoose must be connected
// before queries run, so the first pass waits for the connection.
function startPurgeJob() {
  const HOUR = 60 * 60 * 1000;
  console.log(
    `[purgeDeletedStudents] scheduled daily (retention ${RETENTION_DAYS} days)`,
  );
  const run = async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      await purgeDeletedStudents();
    } catch (err) {
      console.error("[purgeDeletedStudents] run failed:", err.message);
    }
  };
  setTimeout(() => {
    run();
    setInterval(run, 24 * HOUR);
  }, 5 * 60 * 1000);
}

module.exports = { purgeDeletedStudents, startPurgeJob };

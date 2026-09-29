// Report Card PDF (pdfkit), mirrors the feeInvoicePdf / tcPdf pattern:
// A4 document → chunked into a Buffer promise. Renders the exact payload the
// on-screen report card uses (buildReportCard) so PDF and UI never drift.

const C = {
  navy: "#0f172a",
  slate: "#334155",
  slateMuted: "#64748b",
  grayMuted: "#94a3b8",
  border: "#e2e8f0",
  bgTable: "#f1f5f9",
  white: "#ffffff",
  green: "#15803d",
  red: "#b91c1c",
};

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

// Same thresholds as the frontend getRemark so print and screen agree.
function deriveRemark(pct) {
  const value = Number(pct) || 0;
  if (value >= 90) return "Outstanding performance. Keep up the excellent work!";
  if (value >= 80) return "Very good performance. Continue the hard work.";
  if (value >= 70) return "Good performance. Focus on weaker subjects for better results.";
  if (value >= 60) return "Satisfactory. Needs more regular practice and revision.";
  return "Needs significant improvement. Extra attention and support recommended.";
}

/**
 * Generate a printable report card.
 * @param {Object} data - buildReportCard() payload
 * @param {Object} school - School document (name, address, settings...)
 * @param {Object} student - Student mirror row (best-effort) or null
 * @returns {Promise<Buffer>}
 */
const generateReportCardPdf = (data, school = {}, student = null) =>
  new Promise((resolve, reject) => {
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width - 100;
    const centerX = 50;
    const centerOpts = { width: pageW, align: "center" };
    const reportSettings = (school && school.settings && school.settings.reportCard) || {};
    const termLabel = data.examName && data.examName !== "All" ? data.examName : "Report Card";
    const sessionLabel = data.session || "—";

    // ── Header bar ──
    doc.rect(0, 0, doc.page.width, 92).fill(C.navy);
    doc
      .fillColor(C.white)
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(school.name || "School", centerX, 26, centerOpts);
    if (school.address) doc.fontSize(9).font("Helvetica").text(school.address, centerX, 52, centerOpts);
    if (reportSettings.affiliation) {
      doc.fontSize(8).font("Helvetica").text(reportSettings.affiliation, centerX, 64, centerOpts);
    }
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(`${String(termLabel).toUpperCase()} — PROGRESS REPORT`, centerX, 74, centerOpts);
    doc.fontSize(9).font("Helvetica").text(`Session ${sessionLabel}`, centerX, 87, { ...centerOpts });

    let y = 112;

    // ── Student info ──
    const info = [
      ["Student Name", (student && student.name) || data.studentId || "—"],
      ["Admission ID", (student && student.admissionNo) || data.studentId || "—"],
      [
        "Class / Section",
        `${data.class || (student && student.class) || "—"}${
          data.section || (student && student.section) ? ` - ${data.section || student.section}` : ""
        }`,
      ],
      ["Roll No.", (student && student.rollNo) || "—"],
      ["Father's Name", (student && student.parentName) || "—"],
      ["Date of Birth", fmtDate(student && student.dob)],
    ];
    const labelW = 150;
    const colW = (pageW - 40) / 2;
    info.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const xPos = col === 0 ? 50 : 50 + pageW / 2;
      const yy = y + row * 24;
      if (row % 2 === 0) doc.rect(50, yy, pageW, 24).fill(C.bgTable);
      doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica-Bold").text(label, xPos + 8, yy + 7, { width: labelW });
      doc.fillColor(C.slate).font("Helvetica").text(String(value), xPos + 8 + labelW, yy + 7, { width: pageW / 2 - labelW - 16 });
      void colW;
    });
    y += Math.ceil(info.length / 2) * 24 + 20;

    // ── Marks table ──
    const cols = [
      { title: "Subject", w: pageW - 240, align: "left" },
      { title: "Max Marks", w: 80, align: "right" },
      { title: "Marks Obtained", w: 90, align: "right" },
      { title: "Grade", w: 70, align: "center" },
    ];
    doc.rect(50, y, pageW, 24).fill(C.navy);
    let x = 50;
    doc.fillColor(C.white).fontSize(9).font("Helvetica-Bold");
    cols.forEach((col) => {
      doc.text(col.title, x + 8, y + 7, { width: col.w - 16, align: col.align });
      x += col.w;
    });
    y += 24;

    (data.subjects || []).forEach((row, i) => {
      if (i % 2 === 1) doc.rect(50, y, pageW, 22).fill(C.bgTable);
      x = 50;
      doc.fillColor(C.slate).fontSize(9.5);
      const cells = [
        String(row.subject || "—"),
        String(row.maxMarks ?? "—"),
        String(row.marksObtained ?? "—"),
        String(row.grade || "—"),
      ];
      cells.forEach((cell, ci) => {
        const col = cols[ci];
        doc.font(ci === 0 || ci === 3 ? "Helvetica-Bold" : "Helvetica").text(cell, x + 8, y + 6, {
          width: col.w - 16,
          align: col.align,
        });
        x += col.w;
      });
      y += 22;
    });

    // Total row
    doc.rect(50, y, pageW, 24).fill("#e8edf5");
    x = 50;
    const hasSubjects = (data.subjects || []).length > 0;
    const overallGrade = hasSubjects ? gradeForPercentage(data) : "—";
    doc.fillColor(C.navy).fontSize(9.5).font("Helvetica-Bold");
    const totalCells = ["Total", String(data.totalMax ?? 0), String(data.totalObtained ?? 0), overallGrade];
    totalCells.forEach((cell, ci) => {
      doc.text(cell, x + 8, y + 7, { width: cols[ci].w - 16, align: cols[ci].align });
      x += cols[ci].w;
    });
    y += 40;

    // ── Summary strip ──
    const boxes = [
      ["Percentage", `${data.percentage ?? "0.00"}%`],
      ["Overall Grade", overallGrade],
      [
        "Class Rank",
        data.classRank ? `${data.classRank}${data.totalStudents ? ` of ${data.totalStudents}` : ""}` : "—",
      ],
      ["Attendance", data.attendance ? `${data.attendance.pct}%` : "—"],
      ["Result", hasSubjects ? (data.subjects.every((s) => s.passed) ? "PASS" : "FAIL") : "—"],
    ];
    const boxGap = 8;
    const boxW = (pageW - boxGap * (boxes.length - 1)) / boxes.length;
    boxes.forEach(([label, value], i) => {
      const bx = 50 + i * (boxW + boxGap);
      doc.roundedRect(bx, y, boxW, 54, 6).stroke(C.border).lineWidth(1);
      doc.fillColor(C.slateMuted).fontSize(7.5).font("Helvetica-Bold").text(label, bx + 4, y + 9, {
        width: boxW - 8,
        align: "center",
      });
      const isResult = label === "Result";
      doc
        .fillColor(
          isResult && hasSubjects
            ? data.subjects.every((s) => s.passed)
              ? C.green
              : C.red
            : C.navy,
        )
        .fontSize(label === "Class Rank" ? 13 : 15)
        .font("Helvetica-Bold")
        .text(String(value), bx + 4, y + 26, { width: boxW - 8, align: "center" });
    });
    y += 70;

    if (data.attendance) {
      doc
        .fillColor(C.slateMuted)
        .fontSize(8)
        .font("Helvetica")
        .text(
          `Attendance detail: ${data.attendance.present} present · ${data.attendance.absent} absent · ${data.attendance.leave} leave${
            data.attendance.halfDays ? ` · ${data.attendance.halfDays} half days` : ""
          } across ${data.attendance.workingDays} marked days.`,
          centerX,
          y,
          { width: pageW, align: "center" },
        );
      y += 18;
    }

    // ── Remarks ──
    doc.roundedRect(50, y, pageW, 46, 6).fill(C.bgTable);
    doc.fillColor(C.slateMuted).fontSize(8).font("Helvetica-Bold").text("CLASS TEACHER'S REMARKS", 62, y + 8, { width: pageW - 24 });
    doc
      .fillColor(C.slate)
      .fontSize(9.5)
      .font("Helvetica")
      .text(deriveRemark(data.percentage), 62, y + 22, { width: pageW - 24, align: "justify" });
    y += 66;

    if (data.publishedOnly === false) {
      doc
        .fillColor(C.grayMuted)
        .fontSize(8)
        .font("Helvetica-Oblique")
        .text("Draft results included — not final.", centerX, y, { width: pageW, align: "center" });
      y += 16;
    }

    // ── Signature lines ──
    y = Math.max(y, doc.page.height - 170);
    const sigW = 180;
    const drawSig = (sx, caption) => {
      doc.moveTo(sx, y).lineTo(sx + sigW, y).strokeColor(C.slateMuted).lineWidth(1).stroke();
      doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica").text(caption, sx, y + 6, { width: sigW, align: "center" });
    };
    drawSig(50, "Class Teacher");
    drawSig(50 + (pageW - sigW) / 2, "Parent / Guardian");
    drawSig(50 + pageW - sigW, "Principal / Head of School");

    // ── Footer ──
    const footerY = doc.page.height - 50;
    doc.moveTo(50, footerY - 10).lineTo(50 + pageW, footerY - 10).strokeColor(C.border).lineWidth(1).stroke();
    doc
      .fillColor(C.grayMuted)
      .fontSize(7)
      .font("Helvetica")
      .text(
        `Session ${sessionLabel} · Generated on ${fmtDate(new Date())} · School ERP System`,
        50,
        footerY,
        { width: pageW, align: "center" },
      );
    if (reportSettings.footerNote) {
      doc.fontSize(6.5).text(String(reportSettings.footerNote), 50, footerY + 10, {
        width: pageW,
        align: "center",
      });
    }

    doc.end();
  });

// Overall grade from the aggregate percentage using the same band table the
// payload's subject grades came from (grade is recomputed here because the
// payload carries per-subject grades only).
function gradeForPercentage(data) {
  const pct = Number(data.percentage) || 0;
  const bands = (data.gradeBands && data.gradeBands.length
    ? data.gradeBands
    : [
        { grade: "A+", minPct: 90 },
        { grade: "A", minPct: 80 },
        { grade: "B+", minPct: 70 },
        { grade: "B", minPct: 60 },
        { grade: "C", minPct: 50 },
        { grade: "D", minPct: 33 },
        { grade: "F", minPct: 0 },
      ]
  ).slice();
  // Bands arrive descending; find the first whose threshold the pct clears.
  const band = bands.find((b) => pct >= b.minPct) || bands[bands.length - 1];
  return band.grade;
}

module.exports = { generateReportCardPdf };

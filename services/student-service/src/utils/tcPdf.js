// Transfer Certificate PDF (pdfkit), mirrors the feeInvoicePdf pattern:
// A4 document → chunked into a Buffer promise.

const C = {
  navy:      "#0f172a",
  slate:     "#334155",
  slateMuted:"#64748b",
  grayMuted: "#94a3b8",
  border:    "#e2e8f0",
  bgTable:   "#f1f5f9",
  white:     "#ffffff",
};

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

/**
 * Generate a printable Transfer Certificate.
 * @param {Object} tc - TransferCertificate document (lean or plain)
 * @param {Object} school - School document (name, code, address, ...)
 * @returns {Promise<Buffer>}
 */
const generateTcPdf = (tc, school = {}) =>
  new Promise((resolve, reject) => {
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width - 100;
    const snap = tc.snapshot || {};
    const centerX = 50;
    const centerOpts = { width: pageW, align: "center" };

    // ── Header bar ──
    doc.rect(0, 0, doc.page.width, 84).fill(C.navy);
    doc.fillColor(C.white).fontSize(20).font("Helvetica-Bold").text("TRANSFER CERTIFICATE", centerX, 30, { width: pageW, align: "center" });
    doc.fontSize(9).font("Helvetica").text(school.name || "—", centerX, 56, centerOpts);
    if (school.address) doc.text(school.address, centerX, 68, centerOpts);

    let y = 110;

    // ── Certificate number / dates ──
    doc.fillColor(C.slate).fontSize(10).font("Helvetica-Bold").text(`TC No: ${tc.tcNumber || "—"}`, centerX, y, { width: pageW / 2 });
    doc.font("Helvetica").fillColor(C.slateMuted)
      .text(`Issued: ${fmtDate(tc.issueDate)}`, centerX + pageW / 2, y, { width: pageW / 2, align: "right" });
    y += 28;

    doc.moveTo(50, y).lineTo(50 + pageW, y).strokeColor(C.border).lineWidth(1).stroke();
    y += 24;

    // ── Opening statement ──
    doc.fillColor(C.slate).fontSize(11).font("Helvetica")
      .text(
        "This is to certify that the following student was a bonafide student of this school. "
          + "The particulars recorded at the time of issue of this certificate are given below:",
        centerX,
        y,
        { width: pageW, align: "justify", lineGap: 3 },
      );
    y = doc.y + 24;

    // ── Details table ──
    const rows = [
      ["Name of the Student", snap.name || "—"],
      ["Admission ID", snap.admissionNo || tc.studentId || "—"],
      ["Class / Section", `${snap.class || "—"}${snap.section ? ` - ${snap.section}` : ""}`],
      ["Date of Birth", fmtDate(snap.dob)],
      ["Gender", snap.gender || "—"],
      ["Father's Name", snap.parentName || "—"],
      ["Mother's Name", snap.motherName || "—"],
      ["Date of Admission", fmtDate(snap.admissionDate)],
      ["Date of Leaving", fmtDate(tc.leavingDate)],
      ["Conduct", tc.conduct || "Good"],
    ];
    const labelW = 200;
    rows.forEach(([label, value], i) => {
      if (i % 2 === 0) doc.rect(50, y, pageW, 22).fill(C.bgTable);
      doc.fillColor(C.slate).fontSize(9.5).font("Helvetica-Bold").text(label, 60, y + 6, { width: labelW });
      doc.fillColor(C.slate).font("Helvetica").text(String(value), 60 + labelW + 10, y + 6, { width: pageW - labelW - 30 });
      y += 22;
    });
    y += 20;

    // ── Reason / remarks ──
    const noteBlock = (title, body) => {
      if (!body) return;
      doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica-Bold").text(title, centerX, y, { width: pageW });
      doc.fillColor(C.slate).fontSize(10).font("Helvetica").text(body, centerX, y + 14, { width: pageW, align: "justify", lineGap: 3 });
      y = doc.y + 16;
    };
    noteBlock("Reason for leaving", tc.reason);
    noteBlock("Remarks", tc.remarks);
    y += 8;

    // ── Closing ──
    doc.fillColor(C.slate).fontSize(11).font("Helvetica")
      .text(
        "All dues payable to the school have been cleared. We wish the student every success in future endeavors.",
        centerX,
        y,
        { width: pageW, align: "justify", lineGap: 3 },
      );
    y = doc.y + 50;

    // ── Signature lines ──
    const sigW = 180;
    const drawSig = (x, caption) => {
      doc.moveTo(x, y).lineTo(x + sigW, y).strokeColor(C.slateMuted).lineWidth(1).stroke();
      doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica").text(caption, x, y + 6, { width: sigW, align: "center" });
    };
    drawSig(50, "Prepared by");
    drawSig(50 + (pageW - sigW) / 2, "Checked by");
    drawSig(50 + pageW - sigW, "Principal / Head of School");

    if (tc.issuedByName || tc.issuedBy) {
      doc.fontSize(8).fillColor(C.grayMuted)
        .text(`Issued by: ${tc.issuedByName || tc.issuedBy}`, centerX, y + 40, centerOpts);
    }

    // ── Footer ──
    const footerY = doc.page.height - 50;
    doc.moveTo(50, footerY - 10).lineTo(50 + pageW, footerY - 10).strokeColor(C.border).lineWidth(1).stroke();
    doc.fillColor(C.grayMuted).fontSize(7).font("Helvetica")
      .text(`TC No. ${tc.tcNumber || "—"} · Generated by School ERP System`, 50, footerY, { width: pageW, align: "center" });

    doc.end();
  });

module.exports = { generateTcPdf };

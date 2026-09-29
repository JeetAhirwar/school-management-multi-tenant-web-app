const C = {
  navy: "#0f172a",
  slate: "#334155",
  slateMuted: "#64748b",
  grayMuted: "#94a3b8",
  border: "#e2e8f0",
  bgTable: "#f1f5f9",
  white: "#ffffff",
  green: "#059669",
  greenBg: "#ecfdf5",
  amber: "#d97706",
  amberBg: "#fffbeb",
};

const fmtMoney = (value) => {
  const num = Number(value || 0);
  return `Rs. ${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * Generate a styled A4 PDF fee receipt (CLIENT-REQ-040).
 * @param {Object} data    - { payment, invoice, school, studentName, receiptNo }
 * @returns {Promise<Buffer>} PDF buffer
 */
const generateFeeReceiptPdf = (data) =>
  new Promise((resolve, reject) => {
    const PDFDocument = require("pdfkit");
    const { payment, invoice = {}, school = {}, studentName } = data;
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width - 100;

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(C.navy);
    doc.fillColor(C.white).fontSize(20).font("Helvetica-Bold").text("FEE RECEIPT", 50, 28);
    doc.fontSize(10).font("Helvetica").text(payment.receiptNo || "—", 50, 54);
    doc.fontSize(10).text(fmtDate(payment.paidOn), doc.page.width - 150, 54, { width: 100, align: "right" });

    let y = 100;

    // Paid badge
    doc.roundedRect(50, y, 70, 22, 4).fill(C.greenBg);
    doc.fillColor(C.green).fontSize(10).font("Helvetica-Bold").text("PAID", 58, y + 6, { width: 54, align: "center" });
    y += 40;

    // School / student blocks
    doc.fillColor(C.slate).fontSize(9).font("Helvetica-Bold").text("RECEIVED BY", 50, y);
    doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica").text(school.name || "—", 50, y + 14);
    if (school.address) doc.text(school.address, 50, y + 26);
    if (school.phone) doc.text(`Phone: ${school.phone}`, 50, y + 38);

    doc.fillColor(C.slate).font("Helvetica-Bold").text("RECEIVED FROM", 320, y);
    doc.fillColor(C.slateMuted).font("Helvetica").text(studentName || "—", 320, y + 14);
    doc.text(`Student ID: ${payment.studentId || "—"}`, 320, y + 26);
    if (invoice.class) doc.text(`Class: ${invoice.class}`, 320, y + 38);

    y += 70;

    doc.moveTo(50, y).lineTo(50 + pageW, y).strokeColor(C.border).lineWidth(1).stroke();
    y += 15;

    // Details table
    const cols = [
      { label: "Fee Type", x: 50, w: 150 },
      { label: "Mode", x: 200, w: 100 },
      { label: "Reference", x: 300, w: 130 },
      { label: "Received", x: 430, w: 110, align: "right" },
    ];
    doc.rect(50, y, pageW, 24).fill(C.bgTable);
    doc.fillColor(C.slate).fontSize(8).font("Helvetica-Bold");
    cols.forEach((c) => doc.text(c.label, c.x, y + 8, { width: c.w, align: c.align || "left" }));
    y += 24;

    doc.fillColor(C.slate).fontSize(9).font("Helvetica");
    doc.text(invoice.feeType || "—", 50, y + 6, { width: 150 });
    doc.text(payment.mode || "—", 200, y + 6, { width: 100 });
    doc.text(payment.receivedRef || payment.transactionId || "—", 300, y + 6, { width: 130 });
    doc.text(fmtMoney(payment.amount), 430, y + 6, { width: 110, align: "right" });
    y += 30;

    // Cheque details when present
    if (payment.mode === "Cheque" && (payment.chequeNo || payment.bankName)) {
      doc.fillColor(C.slateMuted).fontSize(8).font("Helvetica");
      doc.text(
        [payment.chequeNo ? `Cheque: ${payment.chequeNo}` : null, payment.bankName ? `Bank: ${payment.bankName}` : null]
          .filter(Boolean)
          .join("   ·   "),
        50, y,
        { width: pageW },
      );
      y += 16;
    }

    // Summary
    doc.moveTo(50, y).lineTo(50 + pageW, y).strokeColor(C.border).lineWidth(1).stroke();
    y += 15;

    const summaryX = 350;
    const drawSummaryRow = (label, value, bold = false) => {
      doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica").text(label, summaryX, y, { width: 120 });
      doc.fillColor(bold ? C.navy : C.slate).font(bold ? "Helvetica-Bold" : "Helvetica").text(value, summaryX + 120, y, { width: 80, align: "right" });
      y += 18;
    };

    drawSummaryRow("Invoice Amount:", fmtMoney(invoice.amount));
    drawSummaryRow("Total Paid:", fmtMoney(invoice.paidAmount || 0));
    const balance = Number(invoice.amount || 0) - Number(invoice.paidAmount || 0);
    drawSummaryRow("Balance Due:", fmtMoney(balance), true);

    y += 8;
    drawSummaryRow("Received On:", fmtDate(payment.paidOn));
    drawSummaryRow("Collected By:", payment.collectedBy || "—");

    y += 10;

    if (balance <= 0) {
      doc.roundedRect(50, y, pageW, 28, 4).fill(C.greenBg);
      doc.fillColor(C.green).fontSize(9).font("Helvetica-Bold").text("Fee fully paid. Thank you!", 60, y + 9, { width: pageW - 20 });
    } else {
      doc.roundedRect(50, y, pageW, 28, 4).fill(C.amberBg);
      doc.fillColor(C.amber).fontSize(9).font("Helvetica-Bold").text(`Balance due: ${fmtMoney(balance)}`, 60, y + 9, { width: pageW - 20 });
    }

    // Footer
    const footerY = doc.page.height - 50;
    doc.moveTo(50, footerY - 10).lineTo(50 + pageW, footerY - 10).strokeColor(C.border).lineWidth(1).stroke();
    doc.fillColor(C.grayMuted).fontSize(7).font("Helvetica")
      .text("Computer-generated receipt — valid without signature", 50, footerY, { width: pageW, align: "center" });

    doc.end();
  });

module.exports = { generateFeeReceiptPdf };

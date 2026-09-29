const C = {
  navy:       "#0f172a",
  navyLight:  "#1e293b",
  slate:      "#334155",
  slateMuted: "#64748b",
  grayMuted:  "#94a3b8",
  border:     "#e2e8f0",
  bgLight:    "#f8fafc",
  bgTable:    "#f1f5f9",
  white:      "#ffffff",
  green:      "#059669",
  greenBg:    "#ecfdf5",
  orange:     "#d97706",
  orangeBg:   "#fffbeb",
  red:        "#dc2626",
  redBg:      "#fef2f2",
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

const statusColor = (status) => {
  switch (status) {
    case "Paid":    return { text: C.green, bg: C.greenBg };
    case "Overdue": return { text: C.red, bg: C.redBg };
    case "Partial": return { text: C.orange, bg: C.orangeBg };
    default:        return { text: C.slate, bg: C.bgLight };
  }
};

/**
 * Generate a styled A4 PDF for a student fee invoice.
 * @param {Object} invoice - FeeInvoice document (lean or plain object)
 * @param {Object} school  - School document (name, code, address, etc.)
 * @returns {Promise<Buffer>} PDF buffer
 */
const generateFeeInvoicePdf = (invoice, school = {}) =>
  new Promise((resolve, reject) => {
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width - 100; // usable width

    // ── Header bar ──
    doc.rect(0, 0, doc.page.width, 80).fill(C.navy);
    doc.fillColor(C.white).fontSize(20).font("Helvetica-Bold").text("FEE INVOICE", 50, 28);
    doc.fontSize(10).font("Helvetica").text(invoice.invoiceNumber || invoice._id?.toString()?.slice(-8) || "—", 50, 54);
    doc.fontSize(10).text(fmtDate(invoice.createdAt), doc.page.width - 150, 54, { width: 100, align: "right" });

    let y = 100;

    // ── Status badge ──
    const sc = statusColor(invoice.status);
    doc.roundedRect(50, y, 80, 22, 4).fill(sc.bg);
    doc.fillColor(sc.text).fontSize(10).font("Helvetica-Bold").text(invoice.status || "Unpaid", 58, y + 6, { width: 64, align: "center" });
    y += 40;

    // ── School / Student info ──
    doc.fillColor(C.slate).fontSize(9).font("Helvetica-Bold").text("BILLED BY", 50, y);
    doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica").text(school.name || "—", 50, y + 14);
    if (school.address) doc.text(school.address, 50, y + 26);
    if (school.code) doc.text(`Code: ${school.code}`, 50, y + 38);

    doc.fillColor(C.slate).font("Helvetica-Bold").text("BILLED TO", 320, y);
    doc.fillColor(C.slateMuted).font("Helvetica").text(`Student ID: ${invoice.studentId || "—"}`, 320, y + 14);
    if (invoice.class) doc.text(`Class: ${invoice.class}`, 320, y + 26);
    doc.text(`Session: ${invoice.session || "—"}`, 320, y + 38);

    y += 70;

    // ── Divider ──
    doc.moveTo(50, y).lineTo(50 + pageW, y).strokeColor(C.border).lineWidth(1).stroke();
    y += 15;

    // ── Invoice details table ──
    const cols = [
      { label: "Fee Type", x: 50, w: 160 },
      { label: "Amount", x: 210, w: 100, align: "right" },
      { label: "Paid", x: 310, w: 100, align: "right" },
      { label: "Due Date", x: 410, w: 120, align: "right" },
    ];

    // Table header
    doc.rect(50, y, pageW, 24).fill(C.bgTable);
    doc.fillColor(C.slate).fontSize(8).font("Helvetica-Bold");
    cols.forEach((c) => doc.text(c.label, c.x, y + 8, { width: c.w, align: c.align || "left" }));
    y += 24;

    // Table row
    doc.fillColor(C.slate).fontSize(9).font("Helvetica");
    doc.text(invoice.feeType || "—", 50, y + 6, { width: 160 });
    doc.text(fmtMoney(invoice.amount), 210, y + 6, { width: 100, align: "right" });
    doc.text(fmtMoney(invoice.paidAmount || 0), 310, y + 6, { width: 100, align: "right" });
    doc.text(fmtDate(invoice.dueDate), 410, y + 6, { width: 120, align: "right" });
    y += 30;

    // ── Summary ──
    doc.moveTo(50, y).lineTo(50 + pageW, y).strokeColor(C.border).lineWidth(1).stroke();
    y += 15;

    const summaryX = 350;
    const summaryLabelW = 120;
    const summaryValW = 80;

    const drawSummaryRow = (label, value, bold = false) => {
      doc.fillColor(C.slateMuted).fontSize(9).font("Helvetica").text(label, summaryX, y, { width: summaryLabelW });
      doc.fillColor(bold ? C.navy : C.slate).font(bold ? "Helvetica-Bold" : "Helvetica").text(value, summaryX + summaryLabelW, y, { width: summaryValW, align: "right" });
      y += 18;
    };

    drawSummaryRow("Total Amount:", fmtMoney(invoice.amount));
    drawSummaryRow("Paid:", fmtMoney(invoice.paidAmount || 0));
    const balance = Number(invoice.amount || 0) - Number(invoice.paidAmount || 0);
    drawSummaryRow("Balance Due:", fmtMoney(balance), true);

    y += 10;

    // ── Payment status note ──
    if (invoice.status === "Paid") {
      doc.roundedRect(50, y, pageW, 28, 4).fill(C.greenBg);
      doc.fillColor(C.green).fontSize(9).font("Helvetica-Bold").text("Payment received. Thank you!", 60, y + 9, { width: pageW - 20 });
    } else if (invoice.status === "Overdue") {
      doc.roundedRect(50, y, pageW, 28, 4).fill(C.redBg);
      doc.fillColor(C.red).fontSize(9).font("Helvetica-Bold").text("This invoice is overdue. Please pay at the earliest.", 60, y + 9, { width: pageW - 20 });
    }

    // ── Footer ──
    const footerY = doc.page.height - 50;
    doc.moveTo(50, footerY - 10).lineTo(50 + pageW, footerY - 10).strokeColor(C.border).lineWidth(1).stroke();
    doc.fillColor(C.grayMuted).fontSize(7).font("Helvetica")
      .text("Generated by School ERP System", 50, footerY, { width: pageW, align: "center" });

    doc.end();
  });

module.exports = { generateFeeInvoicePdf };

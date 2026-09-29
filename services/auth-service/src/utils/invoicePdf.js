// ── Color palette ──
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
  greenBorder:"#a7f3d0",
  orange:     "#d97706",
  orangeBg:   "#fffbeb",
  orangeBorder:"#fcd34d",
  red:        "#dc2626",
  redBg:      "#fef2f2",
  redBorder:  "#fca5a5",
};

// ── Currency formatting (Helvetica lacks ₹ glyph — use Rs.) ──
const fmtMoney = (value, currency = "INR") => {
  const num = Number(value || 0);
  const formatted = num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return currency === "INR" ? `Rs. ${formatted}` : `${currency} ${formatted}`;
};

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtDateTime = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// ── Helper: draw a rounded rect (for badges, cards, summary box) ──
function roundedRect(doc, x, y, w, h, r, fill, stroke) {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (fill) doc.fill(fill);
  if (stroke) doc.stroke(stroke);
  doc.restore();
}

// ── Helper: status badge ──
function drawStatusBadge(doc, x, y, status) {
  const s = (status || "issued").toLowerCase();
  let label, bg, fg, border;
  if (s === "paid") {
    label = "PAID";
    bg = C.greenBg;
    fg = C.green;
    border = C.greenBorder;
  } else if (s === "overdue") {
    label = "OVERDUE";
    bg = C.redBg;
    fg = C.red;
    border = C.redBorder;
  } else {
    label = "ISSUED";
    bg = C.orangeBg;
    fg = C.orange;
    border = C.orangeBorder;
  }

  const badgeW = 56;
  const badgeH = 18;
  doc.save();
  doc.roundedRect(x, y, badgeW, badgeH, 4);
  doc.fill(bg);
  doc.stroke(border);
  doc.lineWidth(0.5);
  doc.fontSize(8).font("Helvetica-Bold").fillColor(fg);
  doc.text(label, x, y + 4, { width: badgeW, align: "center" });
  doc.restore();
  return badgeH;
}

/**
 * Generate a modern, professional invoice PDF.
 * Returns a Promise<Buffer>.
 */
const generateInvoicePdf = (invoice) => {
  return new Promise((resolve, reject) => {
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      info: {
        Title: `Invoice ${invoice.invoiceNumber}`,
        Author: "Zipschool OS",
        Subject: "Subscription Invoice",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const LM = 40;  // left margin
    const RM = 40;  // right margin
    const W = 595.28 - LM - RM; // content width
    let y = 0; // vertical cursor

    // ════════════════════════════════════════════════════════════════════
    //  HEADER BAR
    // ════════════════════════════════════════════════════════════════════
    const headerH = 68;
    doc.rect(0, 0, 595.28, headerH).fill(C.navy);

    // Brand
    doc.fontSize(20).font("Helvetica-Bold").fillColor(C.white);
    doc.text("ZIPSCHOOL OS", LM, 18);
    doc.fontSize(9).font("Helvetica").fillColor("#94a3b8");
    doc.text("Subscription Invoice", LM, 42);

    // Invoice meta (right-aligned inside header)
    const metaX = 595.28 - RM - 180;
    doc.fontSize(9).font("Helvetica-Bold").fillColor(C.white);
    doc.text(`Invoice # ${invoice.invoiceNumber || "—"}`, metaX, 16, { width: 180, align: "right" });
    doc.fontSize(8).font("Helvetica").fillColor("#94a3b8");
    doc.text(`Issue Date: ${fmtDate(invoice.createdAt)}`, metaX, 30, { width: 180, align: "right" });
    if (invoice.paidAt) {
      doc.text(`Paid: ${fmtDateTime(invoice.paidAt)}`, metaX, 42, { width: 180, align: "right" });
    } else if (invoice.dueDate) {
      doc.text(`Due: ${fmtDate(invoice.dueDate)}`, metaX, 42, { width: 180, align: "right" });
    }

    y = headerH + 24;

    // ════════════════════════════════════════════════════════════════════
    //  STATUS BADGE (right-aligned, below header)
    // ════════════════════════════════════════════════════════════════════
    drawStatusBadge(doc, 595.28 - RM - 56, y - 2, invoice.status);

    // ════════════════════════════════════════════════════════════════════
    //  TWO-COLUMN: BILL TO (left) | BILLED BY (right)
    // ════════════════════════════════════════════════════════════════════
    const colL = LM;
    const colR = LM + W / 2 + 12;
    const colW = W / 2 - 12;

    // Left column: BILL TO
    doc.fontSize(8).font("Helvetica-Bold").fillColor(C.grayMuted);
    doc.text("BILLED TO", colL, y);
    y += 14;
    doc.fontSize(10).font("Helvetica-Bold").fillColor(C.navy);
    doc.text(invoice.schoolName || "School", colL, y, { width: colW });
    y += 14;
    doc.fontSize(8).font("Helvetica").fillColor(C.slateMuted);
    if (invoice.schoolCode) {
      doc.text(`Code: ${invoice.schoolCode}`, colL, y, { width: colW });
      y += 12;
    }

    // Right column: BILLED BY
    let ry = y - 26; // reset y for right column
    doc.fontSize(8).font("Helvetica-Bold").fillColor(C.grayMuted);
    doc.text("BILLED BY", colR, ry);
    ry += 14;
    doc.fontSize(10).font("Helvetica-Bold").fillColor(C.navy);
    doc.text("Zipschool OS Platform", colR, ry, { width: colW });
    ry += 14;
    doc.fontSize(8).font("Helvetica").fillColor(C.slateMuted);
    doc.text("support@zipschoolos.com", colR, ry, { width: colW });

    y = Math.max(y, ry) + 20;

    // ════════════════════════════════════════════════════════════════════
    //  DIVIDER
    // ════════════════════════════════════════════════════════════════════
    doc.save().lineWidth(0.5).moveTo(LM, y).lineTo(LM + W, y).stroke(C.border).restore();
    y += 16;

    // ════════════════════════════════════════════════════════════════════
    //  SUBSCRIPTION DETAILS TABLE
    // ════════════════════════════════════════════════════════════════════
    doc.fontSize(8).font("Helvetica-Bold").fillColor(C.grayMuted);
    doc.text("SUBSCRIPTION DETAILS", LM, y);
    y += 16;

    // Table column definitions
    const cols = [
      { label: "Description",      x: LM,            w: W * 0.36 },
      { label: "Billing Period",   x: LM + W * 0.36, w: W * 0.22 },
      { label: "Unit Price",       x: LM + W * 0.58, w: W * 0.16, align: "right" },
      { label: "Duration",         x: LM + W * 0.74, w: W * 0.10, align: "center" },
      { label: "Total",            x: LM + W * 0.84, w: W * 0.16, align: "right" },
    ];

    const tableRowH = 22;
    const tableHeaderH = 24;

    // Table header background
    doc.save().rect(LM, y, W, tableHeaderH).fill(C.bgTable).restore();

    // Table header text
    for (const col of cols) {
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.slateMuted);
      doc.text(col.label, col.x, y + 8, {
        width: col.w,
        align: col.align || "left",
      });
    }
    y += tableHeaderH;

    // Table border under header
    doc.save().lineWidth(0.3).moveTo(LM, y).lineTo(LM + W, y).stroke(C.border).restore();
    y += 1;

    // ── Table data row ──
    const durationPeriods = invoice.durationPeriods || 1;
    const unitPrice = durationPeriods > 0 ? Math.round(invoice.amount / durationPeriods) : invoice.amount;
    const planLabel = invoice.planName || "—";
    const cycleLabel = invoice.planCode?.includes("yearly") ? "Yearly" : "Monthly";
    const periodLabel = `${fmtDate(invoice.periodStart)} — ${fmtDate(invoice.periodEnd)}`;
    const totalAmount = invoice.totalAmount || invoice.amount;

    // Row background (alternating)
    doc.save().rect(LM, y, W, tableRowH).fill(C.white).restore();

    doc.fontSize(9).font("Helvetica").fillColor(C.navy);
    doc.text(planLabel, cols[0].x, y + 6, { width: cols[0].w });
    doc.fontSize(8).fillColor(C.slateMuted);
    doc.text(cycleLabel, cols[1].x, y + 6, { width: cols[1].w });
    doc.text(fmtMoney(unitPrice, invoice.currency), cols[2].x, y + 6, { width: cols[2].w, align: "right" });
    doc.text(`${durationPeriods} ${durationPeriods === 1 ? "mo" : "mos"}`, cols[3].x, y + 6, { width: cols[3].w, align: "center" });
    doc.font("Helvetica-Bold").fillColor(C.navy);
    doc.text(fmtMoney(totalAmount, invoice.currency), cols[4].x, y + 6, { width: cols[4].w, align: "right" });

    y += tableRowH;

    // Table bottom border
    doc.save().lineWidth(0.3).moveTo(LM, y).lineTo(LM + W, y).stroke(C.border).restore();
    y += 24;

    // ════════════════════════════════════════════════════════════════════
    //  BILLING PERIOD NOTE
    // ════════════════════════════════════════════════════════════════════
    doc.fontSize(8).font("Helvetica").fillColor(C.grayMuted);
    doc.text(`Billing Period: ${periodLabel}`, LM, y, { width: W });
    y += 20;

    // ════════════════════════════════════════════════════════════════════
    //  SUMMARY BOX (right-aligned)
    // ════════════════════════════════════════════════════════════════════
    const summaryW = 200;
    const summaryX = LM + W - summaryW;
    const summaryLineH = 18;
    const cgst = invoice.cgstAmount || 0;
    const sgst = invoice.sgstAmount || 0;
    const gstTotal = cgst + sgst;
    const finalTotal = totalAmount + gstTotal;
    const rows = [
      { label: "Subtotal", value: fmtMoney(totalAmount, invoice.currency) },
    ];
    if (gstTotal > 0) {
      rows.push({ label: `CGST @${Math.round((cgst / Math.max(1, totalAmount)) * 200)}%`, value: fmtMoney(cgst, invoice.currency) });
      rows.push({ label: `SGST @${Math.round((sgst / Math.max(1, totalAmount)) * 200)}%`, value: fmtMoney(sgst, invoice.currency) });
    }
    rows.push({ label: "Total Paid", value: fmtMoney(finalTotal, invoice.currency), bold: true });

    const summaryH = rows.length * summaryLineH + 14;

    // Summary card background
    doc.save();
    doc.roundedRect(summaryX, y, summaryW, summaryH, 6);
    doc.fill(C.bgLight);
    doc.stroke(C.border);
    doc.lineWidth(0.5);
    doc.restore();

    let sy = y + 8;
    for (const row of rows) {
      const font = row.bold ? "Helvetica-Bold" : "Helvetica";
      const fg = row.bold ? C.navy : C.slate;
      doc.fontSize(8.5).font(font).fillColor(C.grayMuted);
      doc.text(row.label, summaryX + 10, sy, { width: summaryW * 0.55 });
      doc.font(font).fillColor(fg);
      doc.text(row.value, summaryX + 10, sy, { width: summaryW - 20, align: "right" });
      sy += summaryLineH;
      if (row.bold) {
        doc.save().lineWidth(0.3).moveTo(summaryX + 10, sy - 4).lineTo(summaryX + summaryW - 10, sy - 4).stroke(C.border).restore();
      }
    }

    y += summaryH + 20;

    // ════════════════════════════════════════════════════════════════════
    //  PAYMENT INFO
    // ════════════════════════════════════════════════════════════════════
    if (invoice.paidAt) {
      doc.save().lineWidth(0.5).moveTo(LM, y).lineTo(LM + W, y).stroke(C.border).restore();
      y += 10;
      doc.fontSize(8).font("Helvetica").fillColor(C.grayMuted);
      doc.text(
        `Payment confirmed on ${fmtDateTime(invoice.paidAt)} via Razorpay${invoice.paymentOrderId ? ` (Ref: ${invoice.paymentOrderId})` : ""}`,
        LM,
        y,
        { width: W }
      );
      y += 16;
    }

    // ════════════════════════════════════════════════════════════════════
    //  FOOTER
    // ════════════════════════════════════════════════════════════════════
    // Pin footer to near bottom of page
    const footerY = 841.89 - 60; // A4 height minus bottom padding
    doc.save().lineWidth(0.5).moveTo(LM, footerY).lineTo(LM + W, footerY).stroke(C.border).restore();

    doc.fontSize(7.5).font("Helvetica").fillColor(C.grayMuted);
    doc.text("Thank you for your subscription!", LM, footerY + 8, {
      width: W,
      align: "center",
    });
    doc.text(
      "For queries, contact support@zipschoolos.com  |  Computer-generated invoice",
      LM,
      footerY + 20,
      { width: W, align: "center" }
    );

    doc.end();
  });
};

module.exports = { generateInvoicePdf };

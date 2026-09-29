let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("[email] SMTP not configured — emails will be logged to console");
    return null;
  }
  const nodemailer = require("nodemailer");
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10) || 587,
    secure: parseInt(SMTP_PORT, 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
};

const sendEmail = async ({ to, subject, html }) => {
  const transport = getTransporter();
  const from = process.env.SMTP_FROM || "Zipschool OS <noreply@zipschoolos.com>";
  if (!transport) {
    console.log(`[email] SMTP not configured — would send to: ${to}`);
    console.log(`[email] Subject: ${subject}`);
    console.log(`[email] Body preview: ${html?.slice(0, 200)}`);
    return { success: true, logged: true };
  }
  try {
    await transport.sendMail({ from, to, subject, html });
    console.log(`[email] Sent to ${to}: ${subject}`);
    return { success: true };
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
    throw err;
  }
};

module.exports = { sendEmail };

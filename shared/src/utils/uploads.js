// Upload hardening. Multer's declared mimetype is client-controlled and cannot
// be trusted, so the real gate is: (a) a strict extension allowlist that
// rejects active/executable content (.html/.js/.php/.svg/...), and (b) a
// decoded-bytes signature check. Every upload handler must invoke
// assertAllowedUpload BEFORE the file is passed to storage.

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
const DOC_EXT = /\.(jpe?g|png|gif|webp|bmp|pdf|doc|docx|txt)$/i;
// Active/executable content must never reach the public CDN even when the
// multipart Content-Type is forged to look like an image.
const DANGEROUS_EXT = /\.(html?|js|mjs|php|asp|aspx|jsp|cgi|pl|py|sh|exe|bat|cmd|svg|vbs|xml|swf)$/i;

const extOf = (name = "") => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || "").trim());
  return m ? m[1].toLowerCase() : "";
};

// Returns a detected image type ("jpeg"|"png"|"gif"|"webp"|"bmp") from the
// decoded bytes, or null when the buffer is not a recognized image.
const detectImage = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "gif";
  const head = buf.subarray(0, 12).toString("latin1");
  if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") return "webp";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
  return null;
};

const isPdf = (buf) => !!buf && buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

// Validates a multer file in place. Returns an error message, or null when the
// upload is acceptable. Pass { allowDocs: true } where PDF/DOC attachments are
// allowed in addition to images.
const assertAllowedUpload = (file, { allowDocs = false } = {}) => {
  if (!file || !file.size) return "file is required";
  const ext = extOf(file.originalname);
  if (!ext) return "File must have an extension";
  if (DANGEROUS_EXT.test(`.${ext}`)) return `${ext} files are not allowed`;
  const extOk = allowDocs ? DOC_EXT.test(`.${ext}`) : IMAGE_EXT.test(`.${ext}`);
  if (!extOk) {
    return allowDocs
      ? "Only image and PDF/DOC document files are allowed"
      : "Only jpg, png, gif, webp or bmp images are allowed";
  }
  const sig = detectImage(file.buffer);
  if (!sig) {
    if (!(allowDocs && isPdf(file.buffer))) return "File content does not match an allowed type";
  }
  return null;
};

module.exports = { assertAllowedUpload, extOf };
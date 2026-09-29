require("dotenv").config();

// ImageKit is an optional storage provider. Without a complete credential set
// (public/private keys + url endpoint) the provider is treated as NOT
// configured: upload endpoints fail closed with a clear 503 instead of
// throwing SDK errors. Callers must check for null before calling .upload().
// Canonical copy in @school-erp/shared; previously duplicated per service.
const hasImagekitConfig = Boolean(
  process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT,
);

let imagekit = null;
if (hasImagekitConfig) {
  const ImageKit = require("imagekit");
  imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

module.exports = imagekit;
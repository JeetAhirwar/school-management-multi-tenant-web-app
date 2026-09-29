// Dedicated connection to the auth database so the communication service can
// resolve which platform users belong to a school/role (used when fanning out
// notifications). Lazily opened and failure-tolerant: if it cannot connect,
// fan-out is skipped but notice/event creation still succeeds.
const mongoose = require("mongoose");

let connection = null;

function getAuthDb() {
  if (!connection) {
    connection = mongoose.createConnection(process.env.AUTH_MONGODB_URI);
  }
  return connection;
}

module.exports = { getAuthDb };
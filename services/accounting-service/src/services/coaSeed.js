// Idempotent per-school CoA seeding. Safe to call on every request/boot:
// existing system accounts are left untouched, missing ones are inserted.
const Account = require("../models/Account");
const { SYSTEM_ACCOUNTS } = require("../utils/accounts");

async function ensureSystemAccounts(schoolId) {
  const ops = SYSTEM_ACCOUNTS.map((account) => ({
    updateOne: {
      filter: { schoolId, code: account.code },
      update: {
        $setOnInsert: {
          schoolId,
          code: account.code,
          name: account.name,
          type: account.type,
          isSystem: true,
          active: true,
        },
      },
      upsert: true,
    },
  }));
  try {
    await Account.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // Concurrent upserts can race into a duplicate-key error — the document
    // exists either way, which is all we need.
    if (err && err.code !== 11000) throw err;
  }
}

module.exports = { ensureSystemAccounts };


const { execFileSync } = require("child_process");
const dns = require("node:dns");

async function srvRecords(hostname) {
  const ps = [
    "Resolve-DnsName",
    `"_mongodb._tcp.${hostname}"`,
    "-Type SRV",
    "| Where-Object {$_.Type -eq 'SRV'}",
    "| Select-Object -ExpandProperty NameTarget",
  ].join(" ");
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { encoding: "utf8", timeout: 20000 },
  );
  const hosts = [
    ...new Set(
      out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((h) => h.replace(/\.$/, "")),
    ),
  ];
  if (!hosts.length) throw new Error(`Could not resolve SRV records for ${hostname}`);
  return hosts;
}

async function txtParams(hostname) {
  const ps = [
    "(Resolve-DnsName",
    `"${hostname}"`,
    "-Type TXT | Select-Object -ExpandProperty Strings)[0]",
  ].join(" ");
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { encoding: "utf8", timeout: 20000 },
  );
  return Object.fromEntries(new URLSearchParams((out || "").trim()));
}

async function toResolvedUri(srvUri) {
  const u = new URL(srvUri);
  const hosts = await srvRecords(u.hostname);
  const params = await txtParams(u.hostname);
  const creds = u.username
    ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}@`
    : "";
  const db = u.pathname.replace(/^\//, "");
  const q = new URLSearchParams();
  q.set("tls", "true");
  q.set("authSource", params.authSource || "admin");
  if (params.replicaSet) q.set("replicaSet", params.replicaSet);
  q.set("retryWrites", "true");
  q.set("w", "majority");
  return `mongodb://${creds}${hosts.map((h) => `${h}:27017`).join(",")}/${db}?${q.toString()}`;
}

async function resolveDbUri(configuredUri) {
  if (!configuredUri || !String(configuredUri).startsWith("mongodb+srv://")) return configuredUri;
  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${new URL(configuredUri).hostname}`);
    return configuredUri;
  } catch {
    return toResolvedUri(configuredUri);
  }
}

module.exports = { resolveDbUri };
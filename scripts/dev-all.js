const { spawn } = require("child_process");
const dotenv = require("dotenv");
const http = require("http");
const net = require("net");
const path = require("path");

const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, ".env"), override: true });
const services = [
  ["gateway", "api-gateway", 5000],
  ["auth", "services/auth-service", 5001],
  ["student", "services/student-service", 5002],
  ["staff", "services/staff-service", 5003],
  ["academic", "services/academic-service", 5004],
  ["fee", "services/fee-service", 5005],
  ["communication", "services/communication-service", 5006],
  ["library", "services/library-service", 5007],
  ["facility", "services/facility-service", 5008],
  ["accounting", "services/accounting-service", 5009],
];

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: 1500 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function printStatus() {
  console.log("\nService status:");
  for (const [name, directory, port] of services) {
    const healthy = await checkHealth(port);
    const status = healthy ? "RUNNING" : "UNHEALTHY";
    console.log(`[${name}] ${status} http://localhost:${port}`);
  }
  console.log("");
}

// Poll every 2s until every service reports healthy, or the budget runs out.
// nodemon + MongoDB boot takes longer than a single delayed check — a single
// shot was reporting UNHEALTHY for services that were simply still starting.
async function waitUntilHealthy(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastUnhealthy = [...services.map(([, , port]) => port)];
  while (Date.now() < deadline) {
    const results = await Promise.all(
      services.map(async ([, , port]) => {
        const ok = await checkHealth(port);
        return { port, ok };
      }),
    );
    lastUnhealthy = results.filter((r) => !r.ok).map((r) => r.port);
    if (lastUnhealthy.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (lastUnhealthy.length > 0) {
    console.error(
      `\nSome services did not become healthy within ${timeoutMs}ms: ${lastUnhealthy.join(", ")}`,
    );
  }
  await printStatus();
}

let children = [];
let shuttingDown = false;

async function startServices() {
  for (const [name, directory, port] of services) {
    if (await isPortOpen(port)) {
      console.log(`[${name}] already running on port ${port}`);
      continue;
    }

    const child = spawn("npm.cmd", ["run", "dev"], {
      cwd: path.join(root, directory),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
      windowsHide: true,
    });

    const prefix = `[${name}]`;
    child.stdout.on("data", (data) =>
      process.stdout.write(`${prefix} ${data}`),
    );
    child.stderr.on("data", (data) =>
      process.stderr.write(`${prefix} ${data}`),
    );
    child.on("exit", (code) => {
      if (code && !shuttingDown) {
        console.error(`${prefix} exited with code ${code}`);
      }
    });
    children.push(child);
  }

  setTimeout(() => {
    waitUntilHealthy().catch((error) =>
      console.error("Status check failed:", error),
    );
  }, 3000);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
    } else {
      child.kill();
    }
  });
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log(
  "Starting all ERP services. Press Ctrl+C to stop services started by this command.",
);
startServices().catch((error) => {
  console.error(error);
  shutdown();
});

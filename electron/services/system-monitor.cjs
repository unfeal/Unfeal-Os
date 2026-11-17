const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const run = promisify(require("node:child_process").execFile);
const gib = 1024 ** 3;

function metrics() {
  const cpu = os.cpus().reduce((sum, core) => {
    sum.idle += core.times.idle;
    sum.total += Object.values(core.times).reduce((a, b) => a + b, 0);
    return sum;
  }, { idle: 0, total: 0 });
  const total = os.totalmem();
  return { ...cpu, usedGiB: (total - os.freemem()) / gib, totalGiB: total / gib };
}

async function temperature() {
  if (process.platform !== "win32") return null;
  const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe");
  const result = await run(exe, ["--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], {
    windowsHide: true, timeout: 3000, maxBuffer: 4096
  }).catch(() => null);
  const values = result?.stdout.split(/\r?\n/).map((line) => line.trim())
    .filter(Boolean).map(Number).filter((value) => Number.isFinite(value) && value >= 0 && value <= 130);
  return values?.length ? Math.max(...values) : null;
}

module.exports = { metrics, temperature };

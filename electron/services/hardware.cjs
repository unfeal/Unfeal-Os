const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const gib = 1024 ** 3;

async function scanHardware(app) {
  const cpu = os.cpus();
  const gpu = await app.getGPUInfo("basic").catch(() => ({}));
  let nvidiaGiB = 0;
  if (process.platform === "win32") {
    const command = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe");
    const result = await run(command, ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], {
      windowsHide: true, timeout: 3000, maxBuffer: 4096
    }).catch(() => null);
    if (result) nvidiaGiB = Math.max(0, ...result.stdout.trim().split(/\r?\n/).map(Number).filter(Number.isFinite)) / 1024;
  }
  return {
    cpu: cpu[0]?.model || os.arch(),
    threads: cpu.length,
    ramGiB: os.totalmem() / gib,
    freeGiB: os.freemem() / gib,
    nvidiaGiB,
    graphics: [...new Set((gpu.gpuDevice || []).map((device) => device.deviceString).filter(Boolean))]
  };
}

module.exports = { scanHardware };

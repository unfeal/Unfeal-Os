const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const gib = 1024 ** 3;

async function scanHardware(app) {
  const cpu = os.cpus();
  const gpu = await app.getGPUInfo("basic").catch(() => ({}));
  let nvidiaGiB = null;
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")
    ];
    for (const command of candidates) {
      const result = await run(command, ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], {
        windowsHide: true, timeout: 3000, maxBuffer: 4096
      }).catch(() => null);
      if (!result) continue;
      nvidiaGiB = Math.max(0, ...result.stdout.trim().split(/\r?\n/).map(Number).filter(Number.isFinite)) / 1024;
      break;
    }
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

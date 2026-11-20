const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const run = require("node:util").promisify(execFile);

async function windowsApps() {
  if (process.platform !== "win32") throw new Error("Nur unter Windows verfügbar.");
  const root = process.env.SystemRoot || "C:\\Windows";
  const powershell = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const { stdout } = await run(powershell, [
    "-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; ConvertTo-Json -InputObject @(Get-StartApps | Select-Object Name, AppID) -Compress"
  ], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout).filter((app) =>
    typeof app.Name === "string" && typeof app.AppID === "string" && /^[\w.!{}+@-]+$/.test(app.AppID));
}

async function openWindowsApp(id) {
  if (typeof id !== "string" || id.length > 300) throw new Error("Ungültiges Programm.");
  const app = (await windowsApps()).find((candidate) => candidate.AppID === id);
  if (!app) throw new Error("Das Programm ist im Windows-Startmenü nicht verfügbar.");
  const explorer = path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe");
  await new Promise((resolve, reject) => {
    const child = spawn(explorer, [`shell:AppsFolder\\${app.AppID}`], { stdio: "ignore" });
    child.once("spawn", () => { child.unref(); resolve(); });
    child.once("error", reject);
  });
}

module.exports = { windowsApps, openWindowsApp };

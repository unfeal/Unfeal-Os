const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);

async function checkStartupUpdate(app, BrowserWindow, dialog) {
  if (process.platform !== "win32" || process.argv.includes("--skip-startup-update")) return false;
  const installDir = path.dirname(process.execPath);
  if (path.basename(process.execPath).toLowerCase() !== "unfeal os.exe") return false;

  const splash = new BrowserWindow({
    width: 390, height: 175, resizable: false, maximizable: false,
    backgroundColor: "#160f20", autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  const updateZip = path.join(installDir, "UNFEAL-OS.zip");
  const script = path.join(__dirname, "startup-update.ps1");
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
  const parameters = ["-InstallDir", installDir, "-UpdateZip", updateZip];
  try {
    await splash.loadFile(path.join(__dirname, "startup-update.html"));
    try {
      await fs.access(updateZip);
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    const { stdout } = await run(powershell, [...args, "-File", script, ...parameters, "-CheckOnly"], {
      windowsHide: true, timeout: 30000
    });
    if (!stdout.includes("UPDATE_AVAILABLE")) return false;

    // Keep the helper outside resources/app while it replaces that directory.
    const helper = path.join(app.getPath("userData"), "startup-update.ps1");
    await fs.mkdir(path.dirname(helper), { recursive: true });
    await fs.copyFile(script, helper);
    await splash.webContents.executeJavaScript('document.querySelector("[role=status]").textContent = "Update wird installiert. Unfeal OS startet danach …";');
    const processId = String(process.pid);
    const child = spawn(powershell, [...args, "-File", helper, ...parameters, "-WaitForProcessId", processId, "-FromApp", "-Launch"], {
      windowsHide: true, detached: true, stdio: "ignore"
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return true;
  } catch (error) {
    console.error("Startup update check failed:", error.message);
    await dialog.showMessageBox({ type: "warning", message: "Das Update konnte nicht geprüft werden.", detail: "Unfeal OS startet mit der vorhandenen Version." });
    return false;
  } finally {
    if (!splash.isDestroyed()) splash.destroy();
  }
}

module.exports = { checkStartupUpdate };

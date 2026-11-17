const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { verify } = require("node:crypto");

const repo = "unfeal/Unfeal-Os";
const packageName = "UNFEAL-OS-online.zip";

function compareVersions(a, b) {
  const right = b.split(".").map(Number);
  return a.split(".").map(Number).reduce((order, part, index) => order || part - right[index], 0);
}

async function latestUpdate() {
  const version = require("../package.json").version;
  if (process.platform !== "win32" || path.basename(process.execPath).toLowerCase() !== "unfeal os.exe") {
    return { state: "unsupported", version };
  }
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    signal: AbortSignal.timeout(15000)
  });
  if (response.status === 404) return { state: "current", version };
  if (!response.ok) throw new Error("GitHub ist gerade nicht erreichbar.");
  const release = await response.json();
  const next = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
  const assets = new Set(release.assets.map((asset) => asset.name));
  if (!next || compareVersions(next, version) <= 0 || !assets.has(packageName) || !assets.has(packageName + ".sig")) {
    return { state: "current", version };
  }
  return { state: "available", version, next };
}

async function download(name, version, maxBytes) {
  const response = await fetch(`https://github.com/${repo}/releases/download/v${version}/${name}`, {
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok || !response.body) throw new Error("Update-Download fehlgeschlagen.");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error("Die Update-Datei ist zu groß.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

let installing = false;
async function installUpdate(app, expectedVersion) {
  if (installing) throw new Error("Ein Update läuft bereits.");
  installing = true;
  let staged;
  try {
    const update = await latestUpdate();
    if (update.state !== "available" || update.next !== expectedVersion) throw new Error("Bitte erneut nach Updates suchen.");
    const [zip, signature, publicKey] = await Promise.all([
      download(packageName, update.next, 64 * 1024 * 1024),
      download(packageName + ".sig", update.next, 64),
      fs.readFile(path.join(__dirname, "update-public.pem"))
    ]);
    if (signature.length !== 64 || !verify(null, zip, publicKey, signature)) throw new Error("Die Update-Signatur ist ungültig.");

    staged = await fs.mkdtemp(path.join(app.getPath("temp"), "unfeal-update-"));
    const zipPath = path.join(staged, packageName);
    const helper = path.join(staged, "startup-update.ps1");
    const readyFile = path.join(staged, "ready");
    const logPath = path.join(app.getPath("userData"), "online-update.log");
    {
      await fs.writeFile(zipPath, zip);
      await fs.copyFile(path.join(__dirname, "startup-update.ps1"), helper);
      const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const helperArgs = [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper,
        "-InstallDir", path.dirname(process.execPath), "-UpdateZip", zipPath,
        "-ReadyFile", readyFile, "-LogPath", logPath, "-ExpectedVersion", update.next, "-WaitForProcessId", String(process.pid), "-FromApp", "-Launch", "-CleanOnlineStage"
      ];
      const quotePowerShell = (value) => "'" + value.replaceAll("'", "''") + "'";
      const command = "Start-Process -WindowStyle Hidden -FilePath " + quotePowerShell(powershell) +
        " -ArgumentList " + quotePowerShell(helperArgs.map((value) => '"' + value.replaceAll('"', '\"') + '"').join(" "));
      const child = spawn(powershell, [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")
      ], { windowsHide: true, cwd: staged, stdio: "ignore" });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      const deadline = Date.now() + 20000;
      let ready = false;
      while (Date.now() < deadline) {
        ready = await fs.access(readyFile).then(() => true, () => false);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error("Der Installationshelfer konnte nicht gestartet werden. Die App bleibt geöffnet.");
    }
    setImmediate(() => app.quit());
  } catch (error) {
    if (staged) await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    installing = false;
    throw error;
  }
}

module.exports = { latestUpdate, installUpdate };


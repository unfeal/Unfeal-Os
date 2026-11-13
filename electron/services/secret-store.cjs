const fs = require("fs");
const path = require("path");

function createSecretStore(safeStorage, userDataPath) {
  const filePath = path.join(userDataPath, "provider-secrets.json");
  async function readEntries() {
    try {
      const value = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw new Error("Stored provider credentials could not be read.");
    }
  }
  async function writeEntries(entries) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(entries, null, 2), { encoding: "utf8", mode: 0o600 });
      await fs.promises.rename(temporary, filePath);
    } catch (error) {
      try { await fs.promises.unlink(temporary); } catch {}
      throw error;
    }
  }
  async function isAvailable() {
    return typeof safeStorage.isAsyncEncryptionAvailable === "function" && safeStorage.isAsyncEncryptionAvailable();
  }
  async function setSecret(id, value) {
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id) || typeof value !== "string" || !value.trim()) throw new Error("Invalid provider credential.");
    if (!await isAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    if (typeof safeStorage.encryptStringAsync !== "function") throw new Error("Asynchronous secure credential storage is unavailable.");
    const encrypted = await safeStorage.encryptStringAsync(value.trim());
    const entries = await readEntries();
    entries[id] = encrypted.toString("base64");
    await writeEntries(entries);
    return true;
  }
  async function getSecret(id) {
    const encoded = (await readEntries())[id];
    if (typeof encoded !== "string") return null;
    const encrypted = Buffer.from(encoded, "base64");
    if (!encrypted.length) throw new Error("Stored provider credential is invalid.");
    if (typeof safeStorage.decryptStringAsync !== "function") throw new Error("Asynchronous secure credential storage is unavailable.");
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    if (decrypted.shouldReEncrypt) await setSecret(id, decrypted.result);
    return decrypted.result;
  }
  async function removeSecret(id) {
    const entries = await readEntries();
    if (!Object.hasOwn(entries, id)) return false;
    delete entries[id];
    await writeEntries(entries);
    return true;
  }
  async function getStatus(id) {
    const entries = await readEntries();
    return { configured: typeof entries[id] === "string", encryptionAvailable: await isAvailable() };
  }
  return { setSecret, getSecret, removeSecret, getStatus };
}

module.exports = { createSecretStore };

const fs = require("node:fs/promises");
const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const derive = require("node:util").promisify(scrypt);

function createLocalAccount(file) {
  let user = null;
  let busy = false;

  async function read() {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async function authenticate(mode, name, password) {
    if (busy) throw new Error("Bitte warte auf den laufenden Vorgang.");
    if (typeof name !== "string" || !name.trim() || name.length > 64 ||
        typeof password !== "string" || password.length < 8 || password.length > 256) {
      throw new Error("Gib einen Namen und ein Passwort mit 8 bis 256 Zeichen ein.");
    }
    busy = true;
    try {
      const stored = await read();
      name = name.trim();
      if (mode === "register") {
        if (stored) throw new Error("Für dieses Windows-Profil gibt es bereits ein Konto.");
        const salt = randomBytes(32).toString("hex");
        const hash = (await derive(password, salt, 64)).toString("hex");
        await fs.writeFile(file, JSON.stringify({ name, salt, hash }), { flag: "wx", mode: 0o600 });
      } else {
        if (!stored) throw new Error("Lege zuerst ein lokales Konto an.");
        const actual = await derive(password, stored.salt, 64);
        const expected = Buffer.from(stored.hash, "hex");
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || stored.name !== name) {
          throw new Error("Name oder Passwort stimmt nicht.");
        }
      }
      user = name;
      return user;
    } finally { busy = false; }
  }

  return {
    get user() { return user; },
    async status() { return { user, registered: Boolean(await read()) }; },
    authenticate,
    logout() { user = null; }
  };
}

module.exports = { createLocalAccount };

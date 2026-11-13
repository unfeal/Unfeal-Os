const path = require("path");
const { spawn } = require("child_process");

async function start() {
  const { createServer } = await import("vite");
  const viteServer = await createServer({
    configFile: path.join(__dirname, "vite.config.ts"),
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: true
    }
  });

  await viteServer.listen();
  const address = viteServer.httpServer.address();
  if (!address || typeof address === "string") {
    await viteServer.close();
    throw new Error("Vite did not provide a local server address.");
  }

  const devServerUrl = `http://127.0.0.1:${address.port}`;
  const electronPath = require("electron");
  const app = spawn(electronPath, [__dirname], {
    cwd: __dirname,
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
    stdio: "inherit",
    windowsHide: false
  });

  let stopping = false;
  const stop = async (exitCode) => {
    if (stopping) return;
    stopping = true;
    if (app.exitCode === null && !app.killed) app.kill();
    await viteServer.close();
    process.exitCode = exitCode;
  };

  app.on("error", (error) => {
    console.error("Could not start Electron:", error);
    void stop(1);
  });
  app.on("exit", (code, signal) => {
    if (signal) console.error(`Electron exited after ${signal}.`);
    else if (code !== 0) console.error(`Electron exited with code ${code}.`);
    void stop(code ?? 1);
  });

  process.on("SIGINT", () => { void stop(0); });
  process.on("SIGTERM", () => { void stop(0); });
}

start().catch((error) => {
  console.error("UNFEAL OS could not start:", error);
  process.exitCode = 1;
});

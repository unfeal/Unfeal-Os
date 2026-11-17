import { useEffect, useState } from "react";

export type UpdateStatus =
  | { state: "current" | "unsupported"; version: string }
  | { state: "available"; version: string; next: string };

export default function UpdateNotice() {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateStatus>();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    let checking = false;
    async function check() {
      if (checking || installing) return;
      checking = true;
      try {
        const result = await window.unfeal.updates.check();
        if (mounted) setUpdate(result);
      } catch {
        // Retry transient network errors at the next interval.
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = window.setInterval(check, 5 * 60 * 1000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [installing]);

  useEffect(() => {
    void window.unfeal.updates.version().then(setVersion).catch(() => {});
  }, []);

  async function install(next: string) {
    setInstalling(true);
    setError("");
    try {
      await window.unfeal.updates.install(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Das Update konnte nicht installiert werden.");
      setInstalling(false);
    }
  }

  const next = update?.state === "available" ? update.next : undefined;
  return <aside className="update-notice" aria-label="Programmupdate">
    <span>Installiert: {version || update?.version || "…"} </span>
    <span role="status">{installing ? "Update wird heruntergeladen und installiert …" : next ? `Verfügbar: ${next}` : update?.state === "current" ? "Auf dem neuesten Stand" : ""}</span>
    {next && <button type="button" disabled={installing} onClick={() => void install(next)}>Update installieren</button>}
    {error && <p role="alert">{error}</p>}
  </aside>;
}

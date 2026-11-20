import { useState } from "react";

export type WindowsApp = { Name: string; AppID: string };

export default function WindowsAppLauncher() {
  const [apps, setApps] = useState<WindowsApp[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = query.trim() ? apps.filter((app) => app.Name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 8) : [];
  return <div className="windows-app-launcher">
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const found = await window.unfeal.jarvis.listApps();
        setApps(found);
        setStatus(found.length ? "" : "Keine Programme im Windows-Startmenü gefunden.");
      } catch { setStatus("Die Windows-Programmliste konnte nicht geladen werden."); }
      finally { setBusy(false); }
    }}>{busy ? "Bitte warten …" : "Windows-Programme suchen"}</button>
    {apps.length > 0 && <label>Programmname <input type="search" value={query}
      onChange={(event) => { setQuery(event.target.value); setStatus(""); }} /></label>}
    {matches.map(({ Name, AppID }, index) => <button type="button" disabled={busy} key={AppID + index} onClick={async () => {
      setBusy(true);
      try { await window.unfeal.jarvis.openApp(AppID); setStatus(`${Name} wird geöffnet.`); }
      catch { setStatus(`${Name} konnte nicht geöffnet werden.`); }
      finally { setBusy(false); }
    }}>{Name} öffnen</button>)}
    {query.trim() && !matches.length && <p>Keine passenden Programme gefunden.</p>}
    {status && <p role="status">{status}</p>}
  </div>;
}

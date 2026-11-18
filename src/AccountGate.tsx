import { useEffect, useState } from "react";
import App from "./App";

export type AccountStatus = { user: string | null; registered: boolean };

export default function AccountGate() {
  const [status, setStatus] = useState<AccountStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void window.unfeal.account.status().then(setStatus).catch(() => setError("Das lokale Konto konnte nicht geladen werden."));
  }, []);

  if (status?.user) return <App onLogout={async () => {
    await window.unfeal.account.logout();
    setStatus({ registered: true, user: null });
  }} />;

  const register = status?.registered === false;
  return <main className="account-screen">
    <section className="account-card" aria-labelledby="account-title">
      <img src={`${import.meta.env.BASE_URL}unfeal-icon.jpg`} alt="" width="64" height="64" />
      <h1 id="account-title">{!status ? "UNFEAL OS" : register ? "Konto erstellen" : "Bei UNFEAL OS anmelden"}</h1>
      {status && <form onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const user = await window.unfeal.account.authenticate(register ? "register" : "login", String(data.get("name")), String(data.get("password")));
          setStatus({ registered: true, user });
        } catch (failure) {
          setError(failure instanceof Error ? failure.message.replace(/^.*?Error: /, "") : "Der Vorgang ist fehlgeschlagen.");
        } finally { setBusy(false); }
      }}>
        <label>Benutzername<input name="name" autoComplete="username" maxLength={64} required /></label>
        <label>Passwort<input name="password" type="password" minLength={8} maxLength={256} autoComplete={register ? "new-password" : "current-password"} required /></label>
        <button disabled={busy}>{busy ? "Bitte warten …" : register ? "Registrieren" : "Anmelden"}</button>
      </form>}
      {error && <p role="alert">{error}</p>}
      {register && <p>Das Konto gilt für dieses Windows-Profil.</p>}
    </section>
  </main>;
}

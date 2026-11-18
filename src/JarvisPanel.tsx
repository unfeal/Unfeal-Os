import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  abort(): void;
};

export default function JarvisPanel({ busy, progress, reply, onDictation, rounds, agentCount, multiAgent, onRoundsChange, planningCalls }: {
  busy: boolean;
  rounds: number;
  agentCount: number;
  planningCalls: number;
  multiAgent: boolean;
  onRoundsChange: (rounds: number) => void;
  progress: string[];
  reply: string;
  onDictation: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => () => {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!video) return;
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  function dictate() {
    if (recognition.current) {
      recognition.current.abort();
      return;
    }
    const browser = window as Window & {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    setError("");
    if (!SpeechRecognition) {
      setError("Diese Laufzeit unterstützt keine Spracherkennung. Du kannst unten tippen.");
      return;
    }
    const session = new SpeechRecognition();
    session.lang = "de-AT";
    session.onresult = (event) => onDictation(event.results[0]?.[0]?.transcript ?? "");
    session.onerror = (event) => {
      if (event.error !== "aborted") setError("Diktat nicht verfügbar. Prüfe den Mikrofonzugriff und die Verfügbarkeit des Sprachdienstes.");
    };
    session.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = session;
    try {
      session.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setError("Das Mikrofon konnte nicht gestartet werden.");
    }
  }

  function speak() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = "de-AT";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  const active = listening || speaking || busy;
  return (
    <section className="jarvis-panel" aria-label="JARVIS Cockpit">
      <div className="jarvis-core">
        <div className={active ? "jarvis-orb active" : "jarvis-orb"} aria-hidden="true"><i /><i /><i /></div>
        <strong>JARVIS</strong>
        <span role="status">{listening ? "Hört zu" : speaking ? "Spricht" : busy ? "Bearbeitet Auftrag" : "Bereit"}</span>
        <div className="jarvis-controls">
          <button type="button" onClick={dictate} disabled={busy || speaking}>{listening ? "Diktat beenden" : "Diktieren"}</button>
          <button type="button" onClick={speak} disabled={!window.speechSynthesis || !reply || busy || listening}>{speaking ? "Vorlesen stoppen" : "Antwort vorlesen"}</button>
        </div>
        {error && <small role="alert">{error}</small>}
        <small>Das Diktat nutzt den Sprachdienst der Laufzeit. Prüfe den Text vor dem Senden.</small>
      </div>
      <div className="jarvis-workbench">
        <section aria-label="PC-Steuerung">
          <h2>PC-Steuerung</h2>
          <div className="jarvis-controls">
            {[["explorer", "Explorer"], ["editor", "Editor"], ["calculator", "Rechner"], ["choose", "Anderes Programm"], ["computer", "Dieser PC"]].map(([tool, label]) =>
              <button key={tool} type="button" onClick={async () => {
                setError("");
                try { await window.unfeal.jarvis.openTool(tool); }
                catch { setError(`${label} konnte nicht geöffnet werden.`); }
              }}>{label} öffnen</button>
            )}
          </div>
        </section>
        <section aria-label="Agentenaktivität">
          <h2>Agentenaktivität</h2>
          <label>Agentenrunden <select value={multiAgent ? rounds : ""} disabled={busy} onChange={(event) => onRoundsChange(Number(event.target.value))}>
            <option value="" disabled>Runden wählen</option>
            {[1, 2, 3].map((count) => <option key={count} value={count}>
              {count} {count === 1 ? "Runde" : "Runden"} · bis zu {agentCount * count + 1 + planningCalls} Modellaufrufe
            </option>)}
          </select></label>
          {progress.length > 0 ? <ol>{progress.slice(-6).map((item, index) => <li key={index}>{item}</li>)}</ol> : <p>Aktiviere Multi-Agent und sende einen Auftrag, um den Fortschritt hier zu sehen.</p>}
        </section>
        <section aria-label="Videovorschau">
          <h2>Videovorschau</h2>
          <label>Lokales Video öffnen <input type="file" accept="video/*" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) setVideo(file);
          }} /></label>
          {video && <video src={videoUrl || undefined} controls preload="metadata" />}
        </section>
      </div>
    </section>
  );
}

import { useState } from "react";

export interface Hardware {
  cpu: string;
  threads: number;
  ramGiB: number;
  freeGiB: number;
  nvidiaGiB: number | null;
  graphics: string[];
}

type Candidate = [tag: string, estimatedGiB: number];
const categories: { label: string; detail: string; models: Candidate[] }[] = [
  { label: "Alltag & Chat", detail: "Fragen, Zusammenfassungen und allgemeine Assistenz.", models: [["llama3.2:1b", 2], ["qwen3:4b", 5], ["qwen3:8b", 8], ["qwen3:14b", 13]] },
  { label: "Coding", detail: "Code schreiben, erklären und überarbeiten.", models: [["qwen2.5-coder:0.5b", 2], ["qwen2.5-coder:3b", 4], ["qwen2.5-coder:7b", 7], ["qwen2.5-coder:14b", 12]] },
  { label: "Unzensierte KI", detail: "Dolphin-Modelle mit weniger Filtern für offene Gespräche.", models: [["dolphin3:8b", 8]] },
  { label: "Mathe & Logik", detail: "Mehrstufige Aufgaben und mathematische Herleitungen.", models: [["deepseek-r1:1.5b", 3], ["deepseek-r1:7b", 7], ["deepseek-r1:14b", 13]] },
  { label: "Bilder verstehen", detail: "Bilder beschreiben und Fragen dazu beantworten. Nutze dafür einen Client mit Bild-Upload.", models: [["gemma3:4b", 6], ["gemma3:12b", 12], ["gemma3:27b", 23]] },
  { label: "Übersetzen", detail: "Mehrsprachige Texte verstehen und übersetzen.", models: [["qwen2.5:1.5b", 3], ["qwen2.5:7b", 7], ["qwen2.5:14b", 12]] },
  { label: "Kreatives Schreiben", detail: "Ideen, Dialoge und Geschichten entwerfen.", models: [["llama3.2:3b", 4], ["gemma3:4b", 6], ["gemma3:12b", 12]] },
  { label: "Dokumentensuche", detail: "Embeddings für semantische Suche in einem kompatiblen Client.", models: [["nomic-embed-text:latest", 2]] }
];

export default function ModelAdvisor({ installed }: { installed: string[] }) {
  const [hardware, setHardware] = useState<Hardware>();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const category = categories[selected];
  const budget = hardware ? Math.max(Math.min(hardware.ramGiB * .65, hardware.freeGiB - 1), (hardware.nvidiaGiB ?? 0) * .85) : 0;
  const recommendation = [...category.models].reverse().find(([, estimate]) => estimate <= budget);
  const smallest = category.models[0];
  const canFreeMemory = hardware && !recommendation && smallest[1] <= hardware.ramGiB * .65;
  const candidate = recommendation ?? (canFreeMemory ? smallest : undefined);
  const command = candidate && `ollama pull ${candidate[0]}`;

  async function scan() {
    setBusy(true);
    setError("");
    try { setHardware(await window.unfeal.ollama.scan()); }
    catch { setError("Die Hardwaredaten konnten nicht gelesen werden."); }
    finally { setBusy(false); }
  }

  return <section className="model-advisor" aria-labelledby="model-advisor-title">
    <div className="model-advisor-heading">
      <h2 id="model-advisor-title">Ollama-Modellberater</h2>
      <button type="button" onClick={() => void scan()} disabled={busy}>{busy ? "Wird geprüft …" : hardware ? "PC erneut prüfen" : "PC prüfen"}</button>
    </div>
    <label>KI-Kategorie <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setCopied(false); }}>
      {categories.map(({ label }, index) => <option key={label} value={index}>{label}</option>)}
    </select></label>
    <p>{category.detail}</p>
    {error && <p role="alert">{error}</p>}
    {hardware && <>
      <p>{hardware.cpu} · {hardware.threads} logische Kerne · {hardware.ramGiB.toFixed(1)} GiB RAM ({hardware.freeGiB.toFixed(1)} frei)</p>
      {hardware.graphics.length > 0 && <p>Grafik: {hardware.graphics.join(", ")}</p>}
      <p>{hardware.nvidiaGiB !== null ? `Freier NVIDIA-Grafikspeicher: ${hardware.nvidiaGiB.toFixed(1)} GiB` : "Schätzung anhand des Arbeitsspeichers. Dedizierter Grafikspeicher konnte nicht gemessen werden."}</p>
      <div aria-live="polite">
        {candidate ? <>
          <h3>{candidate[0]}</h3>
          <p>{installed.includes(candidate[0]) ? "Bereits installiert · " : ""}Geschätzter Bedarf: {candidate[1]} GiB bei kurzem Kontext.</p>
          {canFreeMemory && <p>Aktuell zu wenig freier Speicher. Schließe andere Programme und prüfe erneut, bevor du das Modell lädst.</p>}
          <div className="model-advisor-command"><code>{command}</code>
            <button type="button" onClick={async () => {
              try { await navigator.clipboard.writeText(command!); setCopied(true); }
              catch { setError("Kopieren nicht möglich. Du kannst den Befehl markieren."); }
            }}>{copied ? "Kopiert" : "Befehl kopieren"}</button>
          </div>
        </> : <p>Das kleinste Modell dieser Kategorie ist {smallest[0]} und braucht geschätzt {smallest[1]} GiB. Aktuelles Speicherbudget: {Math.max(0, budget).toFixed(1)} GiB.</p>}
      </div>
    </>}
  </section>;
}

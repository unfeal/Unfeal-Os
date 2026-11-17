import { useEffect, useState } from "react";

export type SystemSample = { idle: number; total: number; usedGiB: number; totalGiB: number };

export default function SystemMonitor() {
  const [sample, setSample] = useState<SystemSample>();
  const [cpu, setCpu] = useState<number>();
  const [temperature, setTemperature] = useState<number | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let previous: SystemSample | undefined;
    let timer: number;
    async function read() {
      try {
        const next = await window.unfeal.system.metrics();
        if (!active) return;
        if (previous && next.total > previous.total) {
          const usage = 1 - (next.idle - previous.idle) / (next.total - previous.total);
          setCpu(Math.max(0, Math.min(100, usage * 100)));
        }
        setSample(next);
        setError(false);
        previous = next;
      } catch { if (active) setError(true); }
      if (active) timer = window.setTimeout(read, 1500);
    }
    async function readTemperature() {
      const result = await window.unfeal.system.temperature().catch(() => null);
      if (active) setTemperature(result);
    }
    void read();
    void readTemperature();
    const sensors = window.setInterval(readTemperature, 10000);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(sensors); };
  }, []);

  return <section className="system-monitor">
    <h1>Systemmonitor</h1>
    {error && <p role="alert">Die Auslastung konnte nicht aktualisiert werden.</p>}
    <div className="system-monitor-grid">
      <article className="settings-card"><h2>CPU</h2>
        <p>{cpu === undefined ? "Wird gemessen …" : `${cpu.toFixed(0)} %`}</p>
        {cpu !== undefined && <meter aria-label="CPU-Auslastung" min={0} max={100} value={cpu} />}
      </article>
      <article className="settings-card"><h2>Arbeitsspeicher</h2>
        <p>{sample ? `${sample.usedGiB.toFixed(1)} von ${sample.totalGiB.toFixed(1)} GiB belegt` : "Wird gemessen …"}</p>
        {sample && <meter aria-label="RAM-Auslastung" min={0} max={sample.totalGiB} value={sample.usedGiB} />}
      </article>
      <article className="settings-card"><h2>Temperatur</h2>
        <p>{temperature === undefined ? "Sensor wird abgefragt …" : temperature === null ? "Kein NVIDIA-Sensor verfügbar" : `${temperature} °C · NVIDIA-GPU`}</p>
      </article>
    </div>
  </section>;
}

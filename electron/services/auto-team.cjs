const { runMultiAgent } = require("./multi-agent.cjs");

const perspectives = [
  "Ziele und Umfang", "Annahmen und offene Fragen", "Anforderungen und Randfälle",
  "Vorgehensweisen", "Durchführbarkeit", "Risiken und Abhängigkeiten",
  "Qualitätsprüfung", "Ressourcen und Aufwand", "Auswirkungen auf Nutzer", "Nächste Schritte"
];
const tasks = [
  ["Kernpunkte", "Extrahiere die für den Auftrag wichtigsten Punkte."],
  ["Alternativen", "Entwickle eine Alternative und erläutere ihre Vor- und Nachteile."],
  ["Gegenprüfung", "Suche einen möglichen Einwand und prüfe, ob er begründet ist."],
  ["Beispiele", "Formuliere ein konkretes Beispiel oder Szenario."],
  ["Prüfkriterien", "Leite überprüfbare Kriterien für ein brauchbares Ergebnis ab."]
];

function completeTeam(content, count) {
  let planned = [];
  const text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  const embedded = arrayStart >= 0 && arrayEnd > arrayStart ? text.slice(arrayStart, arrayEnd + 1) : "";
  for (const candidate of [text, fenced, embedded]) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate);
      const roles = Array.isArray(value) ? value : value?.roles ?? value?.team;
      if (Array.isArray(roles)) { planned = roles; break; }
    } catch { /* Try the next representation. */ }
  }

  const seenNames = new Set(), seenInstructions = new Set();
  const roles = [];
  for (const role of planned) {
    if (roles.length === count) break;
    const name = typeof role?.name === "string" ? role.name.trim() : "";
    const instruction = typeof role?.instruction === "string" ? role.instruction.trim() : "";
    if (!name || name.length > 80 || !instruction || instruction.length > 400 ||
        seenNames.has(name.toLowerCase()) || seenInstructions.has(instruction.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());
    seenInstructions.add(instruction.toLowerCase());
    roles.push({ name, instruction });
  }

  const fallbackCount = count - roles.length;
  for (let index = 0; roles.length < count; index++) {
    const topic = perspectives[index % perspectives.length];
    const [label, task] = tasks[Math.floor(index / perspectives.length)];
    roles.push({
      name: `Lokal ${index + 1}: ${topic} · ${label}`,
      instruction: `Betrachte den konkreten Auftrag unter dem Aspekt „${topic}“. ${task}`
    });
  }
  return { roles, fallbackCount };
}

async function runAutoTeam({ settings, provider, apiKey, messages, knowledgeContext, signal, onProgress }) {
  const { count, rounds, ceiling, sort } = settings;
  if (!Number.isInteger(count) || count < 2 || count > 50 ||
      !Number.isInteger(rounds) || rounds < 1 || rounds > 3 ||
      typeof ceiling !== "number" || !Number.isFinite(ceiling) || ceiling < 0 || ceiling > 1000 ||
      !["output", "input"].includes(sort)) {
    throw new Error("Agentenlauf: UngÃ¼ltige TeamgrÃ¶ÃŸe, Rundenzahl oder Preisgrenze.");
  }
  if (!apiKey) throw new Error("Agentenlauf: Hinterlege zuerst einen OpenRouter-SchlÃ¼ssel in Settings.");
  const models = (await provider.listPricedModels(apiKey, signal))
    .filter((model) => model.output <= ceiling && model.context >= 16384)
    .sort((a, b) => a[sort] - b[sort] || a.output - b.output || a.input - b.input || a.id.localeCompare(b.id));
  if (!models.length) throw new Error("Agentenlauf: Kein OpenRouter-Modell erfÃ¼llt das Output-Preislimit und die Kontextanforderung.");
  const selected = models[0];
  onProgress(`OpenRouter Â· ${selected.id} Â· Katalogpreise pro Mio. Token: ${selected.input} $ Eingabe / ${selected.output} $ Ausgabe`);
  const prompt = messages.findLast((message) => message.role === "user")?.content || "";
  onProgress("JARVIS stellt das Team zusammen â€¦");
  const planned = await provider.chat(selected.id, [
    { role: "system", content: `Plan exactly ${count} distinct specialist roles to answer the user's request. Use the user's language. Give each role a short name and a concrete, different analytical task. Return only a JSON array of objects with string fields name and instruction. Keep each instruction under 150 characters. These specialists produce text reports only.` },
    { role: "user", content: prompt.slice(0, 8000) }
  ], apiKey, signal, { ceiling, maxTokens: 4096 }).catch((error) => {
    if (signal?.aborted || !/^(OpenRouter hat keinen sichtbaren Antworttext geliefert|OpenRouter hat das Tokenlimit erreicht)/.test(error?.message || "")) throw error;
    return { message: { content: "" } };
  });
  const team = completeTeam(planned.message.content, count);
  if (team.fallbackCount) onProgress(`JARVIS ergänzt ${team.fallbackCount} Rollen lokal.`);
  const roles = team.roles.map((role, index) => ({ id: `auto-${index}`, name: role.name.trim(), instruction: role.instruction.trim() }));
  onProgress(`Team bereit: ${roles.length} Agenten Â· ${rounds} Runden`);
  const cappedProvider = {
    name: provider.name,
    chat: (model, context, key, abort) => provider.chat(model, context, key, abort, { ceiling, maxTokens: 1536 })
  };
  return runMultiAgent({
    providerId: "openrouter", model: selected.id,
    messages: messages.slice(-4).map((message) => ({ ...message, content: message.content.slice(0, 1500) })),
    knowledgeContext, signal, onProgress,
    roles, agentIds: roles.map((role) => role.id), agentRounds: rounds,
    maxCalls: count * rounds + 1, getProvider: () => cappedProvider, getApiKey: async () => apiKey
  });
}

module.exports = { runAutoTeam };

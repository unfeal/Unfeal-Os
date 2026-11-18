const { runMultiAgent } = require("./multi-agent.cjs");

async function runAutoTeam({ settings, provider, apiKey, messages, knowledgeContext, signal, onProgress }) {
  const { count, rounds, ceiling, sort } = settings;
  if (!Number.isInteger(count) || count < 2 || count > 50 ||
      !Number.isInteger(rounds) || rounds < 1 || rounds > 3 ||
      typeof ceiling !== "number" || !Number.isFinite(ceiling) || ceiling < 0 || ceiling > 1000 ||
      !["output", "input"].includes(sort)) {
    throw new Error("Agentenlauf: Ungültige Teamgröße, Rundenzahl oder Preisgrenze.");
  }
  if (!apiKey) throw new Error("Agentenlauf: Hinterlege zuerst einen OpenRouter-Schlüssel in Settings.");
  const models = (await provider.listPricedModels(apiKey, signal))
    .filter((model) => model.output <= ceiling && model.context >= 16384)
    .sort((a, b) => a[sort] - b[sort] || a.output - b.output || a.input - b.input || a.id.localeCompare(b.id));
  if (!models.length) throw new Error("Agentenlauf: Kein OpenRouter-Modell erfüllt das Output-Preislimit und die Kontextanforderung.");
  const selected = models[0];
  onProgress(`OpenRouter · ${selected.id} · Katalogpreise pro Mio. Token: ${selected.input} $ Eingabe / ${selected.output} $ Ausgabe`);
  const prompt = messages.findLast((message) => message.role === "user")?.content || "";
  onProgress("JARVIS stellt das Team zusammen …");
  const planned = await provider.chat(selected.id, [
    { role: "system", content: `Plan exactly ${count} distinct specialist roles to answer the user's request. Use the user's language. Give each role a short name and a concrete, different analytical task. Return only a JSON array of objects with string fields name and instruction. Keep each instruction under 150 characters. These specialists produce text reports only.` },
    { role: "user", content: prompt.slice(0, 8000) }
  ], apiKey, signal, { ceiling, maxTokens: 4096 });
  let team;
  try {
    team = JSON.parse(planned.message.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("Agentenlauf: OpenRouter hat keinen lesbaren Teamplan geliefert.");
  }
  if (!Array.isArray(team) || team.length !== count || team.some((role) =>
    typeof role?.name !== "string" || !role.name.trim() || role.name.length > 80 ||
    typeof role.instruction !== "string" || !role.instruction.trim() || role.instruction.length > 400) ||
    new Set(team.map((role) => role.instruction.trim().toLowerCase())).size !== count ||
    new Set(team.map((role) => role.name.trim().toLowerCase())).size !== count) {
    throw new Error("Agentenlauf: OpenRouter hat nicht genug unterschiedliche Rollen geliefert.");
  }
  const roles = team.map((role, index) => ({ id: `auto-${index}`, name: role.name.trim(), instruction: role.instruction.trim() }));
  onProgress(`Team bereit: ${roles.length} Agenten · ${rounds} Runden`);
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

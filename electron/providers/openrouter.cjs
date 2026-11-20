const API_URL = "https://openrouter.ai/api/v1";

function headers(apiKey) {
  if (!apiKey) throw new Error("Add an OpenRouter API key in Settings.");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function catalog(apiKey, signal) {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(`${API_URL}/models`, { headers: headers(apiKey), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`OpenRouter Modellkatalog fehlgeschlagen (${response.status}).`);
  const { data } = await response.json();
  return Array.isArray(data) ? data.filter((model) => typeof model?.id === "string" &&
    model.architecture?.input_modalities?.includes("text") && model.architecture?.output_modalities?.includes("text")) : [];
}

async function listModels(apiKey) {
  const models = (await catalog(apiKey)).map(({ id, name }) => ({ id, name: name ? `${name} (${id})` : id }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return [{ id: "openrouter/free", name: "Gratis-Modelle (rotierend)" },
    ...models.filter((model) => model.id !== "openrouter/free")];
}

async function listPricedModels(apiKey, signal) {
  const rate = (value) => typeof value === "string" && value.trim() ? Number(value) * 1e6 : NaN;
  return (await catalog(apiKey, signal)).filter((model) =>
    !model.id.startsWith("openrouter/") && !model.id.endsWith(":free") &&
    model.supported_parameters?.includes("max_tokens") &&
    (model.pricing?.request === undefined || Number(model.pricing.request) === 0))
    .map((model) => ({ id: model.id, input: rate(model.pricing?.prompt),
      output: rate(model.pricing?.completion), context: model.context_length }))
    .filter((model) => Number.isFinite(model.output) && model.output >= 0 && Number.isFinite(model.input) && model.input >= 0);
}

async function requestChat(model, messages, apiKey, signal, stream, options = {}) {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ model, messages, max_tokens: options.maxTokens ?? 4096, stream,
      ...(options.ceiling !== undefined ? { provider: { max_price: { completion: options.ceiling } } } : {})
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)
  });
  if (response.status === 429) throw new Error("OpenRouter meldet ein erreichtes Anfrage- oder Gratis-Kontingent (429).");
  if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}). Check your API key, model access and credits.`);
  return response;
}

async function chat(model, messages, apiKey, signal, options) {
  const response = await requestChat(model, messages, apiKey, signal, false, options);
  const result = await response.json();
  const choice = result.choices?.[0];
  if (result.error || choice?.finish_reason === "error") {
    throw new Error("OpenRouter meldet einen Fehler bei der Generierung.");
  }
  const raw = choice?.message?.content;
  const content = typeof raw === "string" ? raw : Array.isArray(raw)
    ? raw.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("")
    : "";
  if (!content.trim()) {
    throw new Error(choice?.finish_reason === "length"
      ? "OpenRouter hat das Tokenlimit erreicht, bevor Antworttext vorlag."
      : "OpenRouter hat keinen sichtbaren Antworttext geliefert.");
  }
  return { message: { role: "assistant", content } };
}

async function chatStream(model, messages, onChunk, signal, apiKey) {
  const response = await requestChat(model, messages, apiKey, signal, true);
  if (!response.body) throw new Error("OpenRouter streaming response is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = done ? "" : lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        if (!payload) continue;
        const event = JSON.parse(payload);
        if (event.error || event.choices?.[0]?.finish_reason === "error") throw new Error("OpenRouter returned a streaming error.");
        const content = event.choices?.[0]?.delta?.content;
        if (typeof content === "string") onChunk(content);
        else if (Array.isArray(content)) {
          for (const part of content) if (part?.type === "text" && typeof part.text === "string") onChunk(part.text);
        }
      }
      if (done) throw new Error("OpenRouter ended the stream unexpectedly.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

module.exports = { name: "OpenRouter", type: "cloud", listModels, listPricedModels, chat, chatStream };

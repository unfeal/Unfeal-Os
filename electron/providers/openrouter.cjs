const API_URL = "https://openrouter.ai/api/v1";

function headers(apiKey) {
  if (!apiKey) throw new Error("Add an OpenRouter API key in Settings.");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function listModels(apiKey) {
  const response = await fetch(`${API_URL}/models`, { headers: headers(apiKey), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`OpenRouter model list failed (${response.status}).`);
  const { data } = await response.json();
  return Array.isArray(data)
    ? data.filter((model) => typeof model?.id === "string" &&
        model.architecture?.input_modalities?.includes("text") &&
        model.architecture?.output_modalities?.includes("text"))
      .map(({ id, name }) => ({ id, name: name ? `${name} (${id})` : id }))
      .sort((left, right) => left.name.localeCompare(right.name))
    : [];
}

async function requestChat(model, messages, apiKey, signal, stream) {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ model, messages, max_tokens: 4096, stream }),
    signal
  });
  if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}). Check your API key, model access and credits.`);
  return response;
}

async function chat(model, messages, apiKey, signal) {
  const response = await requestChat(model, messages, apiKey, signal, false);
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (result.error || typeof content !== "string") throw new Error("OpenRouter returned no text response.");
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
      }
      if (done) throw new Error("OpenRouter ended the stream unexpectedly.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

module.exports = { name: "OpenRouter", type: "cloud", listModels, chat, chatStream };

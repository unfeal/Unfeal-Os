const API_URL = "https://api.anthropic.com/v1";
const API_VERSION = "2026-10-21";

function headers(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) throw new Error("Claude is not configured. Add an Anthropic API key in Settings.");
  return { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION };
}

async function listModels(apiKey) {
  const response = await fetch(`${API_URL}/models?limit=100`, { headers: headers(apiKey) });
  if (!response.ok) throw new Error(`Claude model list failed (${response.status}). Check your API key and account access.`);
  const data = await response.json();
  return Array.isArray(data.data) ? data.data.map((model) => ({ id: model.id, name: model.display_name || model.id })) : [];
}

async function chatStream(model, messages, onChunk, signal, apiKey) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const conversation = messages.filter((message) => message.role !== "system");
  const response = await fetch(`${API_URL}/messages`, {
    method: "POST", headers: headers(apiKey),
    body: JSON.stringify({ model, max_tokens: 4096, messages: conversation, ...(system ? { system } : {}), stream: true }), signal
  });
  if (!response.ok) throw new Error(`Claude request failed (${response.status}). Check the API key, model access, and Anthropic API usage balance.`);
  if (!response.body) throw new Error("Claude streaming response is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split("\n"); pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      const event = JSON.parse(payload);
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") onChunk(event.delta.text);
      if (event.type === "error") throw new Error("Claude returned an API stream error.");
      if (event.type === "message_stop") return;
    }
    if (done) break;
  }
}

async function chat(model, messages, apiKey, signal) {
  let content = "";
  await chatStream(model, messages, (delta) => { content += delta; }, signal, apiKey);
  return { message: { role: "assistant", content } };
}

module.exports = { name: "Claude", type: "cloud", listModels, chat, chatStream };

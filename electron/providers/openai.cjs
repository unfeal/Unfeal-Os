const API_URL = "https://api.openai.com/v1";

function headers(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) throw new Error("OpenAI is not configured. Add an OpenAI API key in Settings.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

async function listModels(apiKey) {
  const response = await fetch(`${API_URL}/models`, { headers: headers(apiKey) });
  if (!response.ok) throw new Error(`OpenAI model list failed (${response.status}). Check your API key and account access.`);
  const data = await response.json();
  return Array.isArray(data.data)
    ? data.data.filter((model) => /^(gpt-|o[1-9])/.test(model.id) && !/(embedding|realtime|audio|transcri|speech|tts|image|moderation)/i.test(model.id)).map((model) => ({ id: model.id, name: model.id }))
    : [];
}

async function chatStream(model, messages, onChunk, signal, apiKey) {
  const response = await fetch(`${API_URL}/responses`, {
    method: "POST", headers: headers(apiKey),
    body: JSON.stringify({ model, input: messages, max_output_tokens: 4096, stream: true }),
    signal
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}). Check the API key, model access, and API billing.`);
  if (!response.body) throw new Error("OpenAI streaming response is unavailable.");
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
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") onChunk(event.delta);
      if (event.type === "response.failed" || event.type === "error") throw new Error("OpenAI returned an API stream error.");
      if (event.type === "response.completed") return;
    }
    if (done) break;
  }
}

async function chat(model, messages, apiKey, signal) {
  let content = "";
  await chatStream(model, messages, (delta) => { content += delta; }, signal, apiKey);
  return { message: { role: "assistant", content } };
}

module.exports = { name: "OpenAI", type: "cloud", listModels, chat, chatStream };

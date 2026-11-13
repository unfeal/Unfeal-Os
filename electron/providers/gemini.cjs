const API_URL = "https://generativelanguage.googleapis.com/v1beta";

function headers(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) throw new Error("Gemini is not configured. Add a Google AI API key in Settings.");
  return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
}

async function listModels(apiKey) {
  const models = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`${API_URL}/models?${query}`, { headers: headers(apiKey) });
    if (!response.ok) throw new Error(`Gemini model list failed (${response.status}). Check your API key and account access.`);
    const data = await response.json();
    for (const model of data.models || []) {
      const methods = model.supportedGenerationMethods || [];
      if (!methods.includes("generateContent") || !methods.includes("streamGenerateContent")) continue;
      const id = typeof model.name === "string" ? model.name.replace(/^models\//, "") : "";
      if (id) models.push({ id, name: model.displayName || id });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return models;
}

async function chatStream(model, messages, onChunk, signal, apiKey) {
  const systemText = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const contents = messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  const response = await fetch(`${API_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST", headers: headers(apiKey),
    body: JSON.stringify({
      contents,
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      generationConfig: { maxOutputTokens: 4096 }
    }),
    signal
  });
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}). Check the API key, model access, and Google AI usage limits.`);
  if (!response.body) throw new Error("Gemini streaming response is unavailable.");
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
      if (!payload || payload === "[DONE]") continue;
      const packet = JSON.parse(payload);
      for (const candidate of packet.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if (typeof part.text === "string") onChunk(part.text);
        }
      }
      if (packet.promptFeedback?.blockReason) throw new Error("Gemini blocked the request based on its safety settings.");
    }
    if (done) break;
  }
}

async function chat(model, messages, apiKey, signal) {
  let content = "";
  await chatStream(model, messages, (delta) => { content += delta; }, signal, apiKey);
  return { message: { role: "assistant", content } };
}

module.exports = { name: "Gemini", type: "cloud", listModels, chat, chatStream };

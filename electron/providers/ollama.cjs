const OLLAMA_URL = "http://127.0.0.1:11434";

async function listModels() {
  const response = await fetch(`${OLLAMA_URL}/api/tags`);

  if (!response.ok) {
    throw new Error("Ollama is not responding.");
  }

  const data = await response.json();
  return data.models || [];
}

async function chat(model, messages, _apiKey, signal) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    }),
    signal
  });

  if (!response.ok) {
    throw new Error("Ollama chat request failed.");
  }

  return await response.json();
}

async function chatStream(model, messages, onChunk, signal) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, stream: true }), signal });
  if (!response.ok) throw new Error("Ollama chat request failed.");
  if (!response.body) throw new Error("Ollama streaming response is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split("\n"); pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const packet = JSON.parse(line);
      if (typeof packet.message?.content === "string" && packet.message.content) onChunk(packet.message.content);
      if (packet.done) return;
    }
    if (done) break;
  }
}

module.exports = {
  name: "Ollama",
  type: "local",
  listModels,
  chat,
  chatStream
};

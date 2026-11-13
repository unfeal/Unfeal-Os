const ollama = require("../providers/ollama.cjs");
const anthropic = require("../providers/anthropic.cjs");
const openai = require("../providers/openai.cjs");
const gemini = require("../providers/gemini.cjs");

const openrouter = require("../providers/openrouter.cjs");

const providers = {
  ollama,
  anthropic,
  openai,
  gemini,
  openrouter
};

function getProviders() {
  return Object.entries(providers).map(([id, provider]) => ({
    id,
    name: provider.name,
    type: provider.type
  }));
}

function getProvider(id) {
  const provider = providers[id];

  if (!provider) {
    throw new Error(`Unknown AI provider: ${id}`);
  }

  return provider;
}

module.exports = {
  getProviders,
  getProvider
};


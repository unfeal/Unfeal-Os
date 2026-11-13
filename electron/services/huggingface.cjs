const API_URL = "https://huggingface.co/api";

function validateQuery(query) {
  if (typeof query !== "string" || query.trim().length < 2 || query.trim().length > 100) {
    throw new Error("Search text must contain 2 to 100 characters.");
  }
  return query.trim();
}

async function searchGGUFModels(query) {
  const params = new URLSearchParams({ search: validateQuery(query), filter: "gguf", sort: "downloads", direction: "-1", limit: "24" });
  const response = await fetch(`${API_URL}/models?${params}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Hugging Face search failed (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Hugging Face returned an invalid model list.");
  return data.slice(0, 24).map((item) => ({
    id: typeof item.id === "string" ? item.id : "",
    author: typeof item.author === "string" ? item.author : "",
    downloads: Number.isFinite(item.downloads) ? item.downloads : 0,
    likes: Number.isFinite(item.likes) ? item.likes : 0,
    lastModified: typeof item.lastModified === "string" ? item.lastModified : "",
    gated: item.gated === true || item.gated === "auto" || item.gated === "manual",
    tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string").slice(0, 20) : []
  })).filter((item) => item.id);
}

async function listGGUFFiles(repoId) {
  if (typeof repoId !== "string" || !/^[^/]{1,100}\/[^/]{1,100}$/.test(repoId)) {
    throw new Error("Invalid Hugging Face model repository.");
  }
  const safeRepoId = repoId.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${API_URL}/models/${safeRepoId}?blobs=true`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "This repository is gated or requires Hugging Face access."
    : `Hugging Face file listing failed (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.siblings)) throw new Error("Hugging Face returned no repository file list.");
  return data.siblings.filter((file) => typeof file.rfilename === "string" && file.rfilename.toLowerCase().endsWith(".gguf"))
    .slice(0, 100)
    .map((file) => ({ path: file.rfilename.slice(0, 500), size: Number.isFinite(file.size) ? file.size : Number.isFinite(file.lfs?.size) ? file.lfs.size : null }));
}

module.exports = { searchGGUFModels, listGGUFFiles };

const { contextBridge, ipcRenderer } = require("electron");
let activeChatRequestId = null;

contextBridge.exposeInMainWorld("unfeal", {
  system: {
    metrics: () => ipcRenderer.invoke("system:metrics"),
    temperature: () => ipcRenderer.invoke("system:temperature")
  },
  account: {
    status: () => ipcRenderer.invoke("account:status"),
    authenticate: (mode, name, password) => ipcRenderer.invoke("account:authenticate", mode, name, password),
    logout: () => ipcRenderer.invoke("account:logout")
  },
  updates: {
    version: () => ipcRenderer.invoke("updates:version"),
    check: () => ipcRenderer.invoke("updates:check"),
    install: (version) => ipcRenderer.invoke("updates:install", version)
  },
  jarvis: { openTool: (tool) => ipcRenderer.invoke("jarvis:open-tool", tool) },
  app: {
    openExternal: (url) => ipcRenderer.invoke("app:open-external", url)
  },
  workspace: {
    choose: () => ipcRenderer.invoke("workspace:choose"),
    files: (root) => ipcRenderer.invoke("workspace:files", root)
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: (project) => ipcRenderer.invoke("projects:create", project),
    delete: (id) => ipcRenderer.invoke("projects:delete", id)
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    models: (providerId) => ipcRenderer.invoke("providers:models", providerId),
    credentials: {
      status: (providerId) => ipcRenderer.invoke("providers:credentials:status", providerId),
      save: (providerId, apiKey) => ipcRenderer.invoke("providers:credentials:save", providerId, apiKey),
      remove: (providerId) => ipcRenderer.invoke("providers:credentials:remove", providerId)
    },
    chat: (request) => ipcRenderer.invoke("providers:chat", request),
    streamChat: (request, onChunk, onProgress) => new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      activeChatRequestId = requestId;
      const cleanup = () => {
        ipcRenderer.removeListener("providers:chat:stream:chunk", handleChunk);
        ipcRenderer.removeListener("providers:chat:stream:done", handleDone);
        ipcRenderer.removeListener("providers:chat:stream:error", handleError);
        if (activeChatRequestId === requestId) activeChatRequestId = null;
      };
      const handleChunk = (_event, payload) => {
        if (payload?.requestId !== requestId) return;
        if (typeof payload.delta === "string") { try { onChunk(payload.delta); } catch (error) { console.error(error); } }
        if (typeof payload.progress === "string" && typeof onProgress === "function") { try { onProgress(payload.progress); } catch (error) { console.error(error); } }
      };
      const handleDone = (_event, payload) => { if (payload?.requestId === requestId) { cleanup(); resolve(payload); } };
      const handleError = (_event, payload) => { if (payload?.requestId === requestId) { cleanup(); reject(new Error(payload.error || "Chat stream failed.")); } };
      ipcRenderer.on("providers:chat:stream:chunk", handleChunk);
      ipcRenderer.on("providers:chat:stream:done", handleDone);
      ipcRenderer.on("providers:chat:stream:error", handleError);
      ipcRenderer.send("providers:chat:stream:start", { requestId, request });
    }),
    cancelChat: () => { if (activeChatRequestId) ipcRenderer.send("providers:chat:stream:cancel", activeChatRequestId); }
  },
  chats: {
    list: (limit) => ipcRenderer.invoke("chats:list", limit),
    search: (query, limit) => ipcRenderer.invoke("chats:search", query, limit),
    get: (id) => ipcRenderer.invoke("chats:get", id),
    summarize: (id) => ipcRenderer.invoke("chats:summarize", id),
    saveTurn: (turn) => ipcRenderer.invoke("chats:save-turn", turn),
    exportMarkdown: (payload) => ipcRenderer.invoke("chats:export-markdown", payload),
    delete: (id) => ipcRenderer.invoke("chats:delete", id),
    rename: (id, title) => ipcRenderer.invoke("chats:rename", id, title)
  },
  ollama: {
    scan: () => ipcRenderer.invoke("ollama:scan"),
    list: () => ipcRenderer.invoke("ollama:list")
  },
  huggingface: {
    searchGGUF: (query) => ipcRenderer.invoke("huggingface:models:search", query),
    listGGUFFiles: (repoId) => ipcRenderer.invoke("huggingface:models:files", repoId)
  },
  knowledge: {
    search: (query) => ipcRenderer.invoke("knowledge:search", query),
    history: { list: (limit) => ipcRenderer.invoke("knowledge:history:list", limit) },
    outbox: { list: (limit) => ipcRenderer.invoke("knowledge:outbox:list", limit) },
    backup: { export: () => ipcRenderer.invoke("knowledge:backup:export"), restore: () => ipcRenderer.invoke("knowledge:backup:restore") },
    vault: {
      sync: () => ipcRenderer.invoke("knowledge:vault:sync")
    },
    memories: {
      list: () => ipcRenderer.invoke("knowledge:memories:list"),
      create: (item) => ipcRenderer.invoke("knowledge:memories:create", item),
      update: (id, item) => ipcRenderer.invoke("knowledge:memories:update", id, item),
      delete: (id) => ipcRenderer.invoke("knowledge:memories:delete", id)
    },
    documents: {
      list: () => ipcRenderer.invoke("knowledge:documents:list"),
      create: (item) => ipcRenderer.invoke("knowledge:documents:create", item),
      update: (id, item) => ipcRenderer.invoke("knowledge:documents:update", id, item),
      delete: (id) => ipcRenderer.invoke("knowledge:documents:delete", id),
      importMarkdown: () => ipcRenderer.invoke("knowledge:documents:import-markdown"),
      exportMarkdown: (item) => ipcRenderer.invoke("knowledge:documents:export-markdown", item)
    },
    relations: {
      list: () => ipcRenderer.invoke("knowledge:relations:list"),
      create: (relation) => ipcRenderer.invoke("knowledge:relations:create", relation),
      update: (id, relation) => ipcRenderer.invoke("knowledge:relations:update", id, relation),
      delete: (id) => ipcRenderer.invoke("knowledge:relations:delete", id)
    }
  }
});

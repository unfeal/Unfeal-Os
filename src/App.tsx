import UpdateNotice, { type UpdateStatus } from "./UpdateNotice";
import JarvisPanel from "./JarvisPanel";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const pages = ["Overview", "AI Chat", "Projects", "Models", "Knowledge", "Settings"];

type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

type OllamaModel = {
  name: string;
  size: number;
  modified_at: string;
};
type ChatProvider = "ollama" | "anthropic" | "openai" | "gemini" | "openrouter";
type AgentRoleId = "researcher" | "developer" | "security" | "critic";
type AgentModelSelections = Partial<Record<AgentRoleId, string>>;
type AgentProviderSelections = Partial<Record<AgentRoleId, ChatProvider>>;
type RemoteChatProvider = Exclude<ChatProvider, "ollama">;
const chatProviderNames: Record<ChatProvider, string> = { ollama: "Ollama", anthropic: "Claude", openai: "OpenAI", gemini: "Gemini", openrouter: "OpenRouter" };
type RemoteModel = { id: string; name: string };
type HuggingFaceModel = { id: string; author: string; downloads: number; likes: number; lastModified: string; gated: boolean; tags: string[] };
type HuggingFaceGGUFFile = { path: string; size: number | null };
type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatSession = { id: string; title: string; model: string; created_at: string; updated_at: string; message_count: number };
type StoredChat = Omit<ChatSession, "message_count"> & { messages: ChatMessage[] };
const agentRoles: { id: AgentRoleId; label: string }[] = [
  { id: "researcher", label: "Researcher" },
  { id: "developer", label: "Developer" },
  { id: "security", label: "Security Analyst" },
  { id: "critic", label: "Critic" }
];

function parseChatModel(value: string) {
  const configured = /^multi-config:(.+)$/.exec(value);
  if (configured) {
    try {
      const config = JSON.parse(decodeURIComponent(configured[1]));
      const validIds = new Set<AgentRoleId>(agentRoles.map((agent) => agent.id));
      const filteredIds: AgentRoleId[] = Array.isArray(config.agentRoleIds)
        ? config.agentRoleIds.filter((id: unknown): id is AgentRoleId => typeof id === "string" && validIds.has(id as AgentRoleId))
        : [];
      const ids = Array.from(new Set<AgentRoleId>(filteredIds));
      const provider = config.provider as ChatProvider;
      const model = config.model;
      if (ids.length >= 2 && ids.length <= 4 && ["ollama", "anthropic", "openai", "gemini", "openrouter"].includes(provider) &&
          typeof model === "string" && model.length <= 200 && [1, 2, 3].includes(config.agentRounds) &&
          Number.isInteger(config.maxAgentCalls) && config.maxAgentCalls >= ids.length * config.agentRounds + 1 && config.maxAgentCalls <= 13) {
        const agentModelSelections: AgentModelSelections = {};
        const agentProviderSelections: AgentProviderSelections = {};
        if (config.agentModelSelections && typeof config.agentModelSelections === "object") {
          for (const id of ids) {
            const selection = config.agentModelSelections[id];
            if (typeof selection === "string" && selection.length <= 200) agentModelSelections[id] = selection;
          }
        }
        if (config.agentProviderSelections && typeof config.agentProviderSelections === "object") {
          for (const id of ids) {
            const selection = config.agentProviderSelections[id];
            if (["ollama", "anthropic", "openai", "gemini", "openrouter"].includes(selection)) agentProviderSelections[id] = selection;
          }
        }
        return {
          multiAgent: true,
          agentRoleIds: ids,
          agentModelSelections,
          agentProviderSelections,
          includeKnowledge: config.includeKnowledge === true,
          agentRounds: config.agentRounds as number,
          maxAgentCalls: config.maxAgentCalls as number,
          provider,
          model
        };
      }
    } catch { /* Fall through to the legacy chat format. */ }
  }
  const custom = /^multi-((?:researcher|developer|security|critic)(?:_(?:researcher|developer|security|critic))*)-(1|2|3)-(3|4|5|6|7|8|9|10|11|12|13):(ollama|anthropic|openai|gemini|openrouter):(.*)$/.exec(value);
  if (custom) return {
    multiAgent: true,
    agentRoleIds: custom[1].split("_") as AgentRoleId[],
    agentModelSelections: {},
    agentProviderSelections: {},
    includeKnowledge: false,
    agentRounds: Number(custom[2]),
    maxAgentCalls: Number(custom[3]),
    provider: custom[4] as ChatProvider,
    model: custom[5]
  };
  const legacy = /^(multi(?:-(2|3|4)(?:-(1|2|3)(?:-(3|4|5|6|7|8|9|10|11|12|13))?)?)?:)?(ollama|anthropic|openai|gemini|openrouter):(.*)$/.exec(value);
  const count = Number(legacy?.[2] || 3);
  const rounds = Number(legacy?.[3] || 1);
  return {
    multiAgent: Boolean(legacy?.[1]),
    agentRoleIds: agentRoles.slice(0, count).map((agent) => agent.id),
    agentModelSelections: {},
    agentProviderSelections: {},
    includeKnowledge: false,
    agentRounds: rounds,
    maxAgentCalls: Number(legacy?.[4] || Math.max(5, count * rounds + 1)),
    provider: legacy ? legacy[5] as ChatProvider : "ollama",
    model: legacy ? legacy[6] : value
  };
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g);
  return parts.map((part, index) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <a key={index} href={link[2]} onClick={(event) => { event.preventDefault(); void window.unfeal.app.openExternal(link[2]); }}>{link[1]}</a>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function ChatCodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error("Could not copy code block", error);
    }
  }
  return (
    <pre className="chat-code">
      {language && <span>{language}</span>}
      <button type="button" onClick={copyCode} aria-label="Code kopieren">{copied ? "Kopiert" : "Kopieren"}</button>
      <code>{code}</code>
    </pre>
  );
}

function ChatMessageContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, index) => <Fragment key={index}>{index > 0 && <br />}{renderInlineMarkdown(line)}</Fragment>)}</p>);
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<ChatCodeBlock code={code.join("\n")} language={language} key={`code-${blocks.length}`} />);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2]);
      blocks.push(level === 1 ? <h2 key={`h-${blocks.length}`}>{content}</h2> : level === 2 ? <h3 key={`h-${blocks.length}`}>{content}</h3> : <h4 key={`h-${blocks.length}`}>{content}</h4>);
      index++;
      continue;
    }
    const listMatch = /^\s*([-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      const ordered = /^\d/.test(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*([-*+]\s+|\d+[.)]\s+)(.*)$/.exec(lines[index]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(item[2]);
        index++;
      }
      const listItems = items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>);
      blocks.push(ordered ? <ol key={`list-${blocks.length}`}>{listItems}</ol> : <ul key={`list-${blocks.length}`}>{listItems}</ul>);
      continue;
    }
    if (!line.trim()) flushParagraph();
    else paragraph.push(line);
    index++;
  }
  flushParagraph();
  return <div className="chat-markdown">{blocks}</div>;
}

type KnowledgeItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  source?: string | null;
  created_at: string;
  updated_at: string;
};
type KnowledgeGraphNode = KnowledgeItem & { graphType: KnowledgeEntityType };

type KnowledgeInput = { title: string; content: string; category: string };
type KnowledgeEntityType = "memory" | "document";
type KnowledgeRelation = {
  id: string;
  source_type: KnowledgeEntityType;
  source_id: string;
  source_title: string;
  target_type: KnowledgeEntityType;
  target_id: string;
  target_title: string;
  relation_type: string;
  created_at: string;
};
type KnowledgeSearchResult = KnowledgeItem & {
  type: KnowledgeEntityType;
  score: number;
};
type KnowledgeVaultSync = { checked: number; imported: number; restored: number; conflicts: number };
type KnowledgeHistoryEvent = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  title: string;
  created_at: string;
};
type KnowledgeOutboxItem = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  title: string;
  created_at: string;
};
type KnowledgeRestoreSummary = { memories: number; documents: number; relations: number; historyEvents: number; outboxEntries: number; chats: number; chatMessages: number; conflicts: number };

function KnowledgeGraph({ items, relations, onSelect, onSelectRelation }: { items: KnowledgeGraphNode[]; relations: KnowledgeRelation[]; onSelect: (item: KnowledgeGraphNode) => void; onSelectRelation: (relation: KnowledgeRelation) => void }) {
  const [filter, setFilter] = useState<"all" | KnowledgeEntityType | "connected">("all");
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const connectedIds = new Set(relations.flatMap((relation) => [relation.source_id, relation.target_id]));
  const matchingItems = items.filter((item) =>
    (filter === "all" || filter === "connected" || item.graphType === filter) &&
    (filter !== "connected" || connectedIds.has(item.id)) &&
    `${item.title} ${item.category}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const filteredItems = filter === "all"
    ? [...matchingItems.filter((item) => item.graphType === "memory").slice(0, 40), ...matchingItems.filter((item) => item.graphType === "document").slice(0, 40)]
    : matchingItems.slice(0, 80);
  const memoryNodes = filteredItems.filter((item) => item.graphType === "memory");
  const documentNodes = filteredItems.filter((item) => item.graphType === "document");
  const rows = Math.max(memoryNodes.length, documentNodes.length, 1);
  const height = Math.max(440, rows * 104 + 56);
  const moreAvailable = filteredItems.length < matchingItems.length;
  const viewWidth = 1000 / zoom;
  const viewHeight = height / zoom;
  const viewX = (1000 - viewWidth) / 2;
  const viewY = (height - viewHeight) / 2;
  const positions = new Map<string, { x: number; y: number }>();
  memoryNodes.forEach((item, index) => positions.set(item.id, { x: 260, y: 62 + index * 104 }));
  documentNodes.forEach((item, index) => positions.set(item.id, { x: 740, y: 62 + index * 104 }));
  const visibleRelations = relations.filter((relation) => positions.has(relation.source_id) && positions.has(relation.target_id));

  return (
    <section className="knowledge-graph-panel">
      <div className="knowledge-graph-toolbar">
        <div className="knowledge-graph-legend"><span><i className="memory-dot" />Memories {memoryNodes.length}</span><span><i className="document-dot" />Documents {documentNodes.length}</span><span>{visibleRelations.length} Verbindungen</span></div>
        <div className="knowledge-graph-controls">
          <input className="knowledge-graph-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Knoten suchen …" aria-label="Graph-Knoten suchen" />
          <div className="knowledge-graph-filters" aria-label="Graph filtern">
            <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Alle</button>
            <button className={filter === "memory" ? "selected" : ""} onClick={() => setFilter("memory")}>Memories</button>
            <button className={filter === "document" ? "selected" : ""} onClick={() => setFilter("document")}>Documents</button>
            <button className={filter === "connected" ? "selected" : ""} onClick={() => setFilter("connected")}>Verknüpft</button>
          </div>
          <div className="knowledge-graph-zoom" aria-label="Graph-Zoom">
            <button onClick={() => setZoom((value) => Math.max(0.7, Math.round((value - 0.15) * 100) / 100))} aria-label="Herauszoomen">−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => Math.min(1.8, Math.round((value + 0.15) * 100) / 100))} aria-label="Hineinzoomen">+</button>
            <button onClick={() => setZoom(1)} aria-label="Zoom zurücksetzen">↺</button>
          </div>
        </div>
      </div>
      {filteredItems.length === 0 ? <p className="knowledge-graph-empty">Keine passenden Einträge. Passe die Suche oder den Filter an.</p> : (
        <div className="knowledge-graph-scroll">
          <svg className="knowledge-graph" viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} role="img" aria-label="Knowledge Graph mit Memories, Documents und ihren Verbindungen">
            <defs><marker id="knowledge-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#9370b7" /></marker></defs>
            {visibleRelations.map((relation) => {
              const source = positions.get(relation.source_id)!;
              const target = positions.get(relation.target_id)!;
              const middleX = (source.x + target.x) / 2;
              const middleY = (source.y + target.y) / 2;
              return <g key={relation.id} className="knowledge-graph-edge" role="button" tabIndex={0} aria-label={`Verbindung ${relation.relation_type} bearbeiten`} onClick={() => onSelectRelation(relation)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectRelation(relation); } }}><line x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#knowledge-arrow)" /><text x={middleX} y={middleY - 7} textAnchor="middle">{relation.relation_type}</text></g>;
            })}
            {filteredItems.map((item) => {
              const position = positions.get(item.id)!;
              return (
                <g key={`${item.graphType}-${item.id}`} className={`knowledge-graph-node ${item.graphType}`} role="button" tabIndex={0} aria-label={`${item.graphType === "memory" ? "Memory" : "Document"}: ${item.title}, öffnen`} onClick={() => onSelect(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item); } }}>
                  <rect x={position.x - 138} y={position.y - 31} width="276" height="62" rx="12" />
                  <circle cx={position.x - 117} cy={position.y} r="5" />
                  <text className="knowledge-graph-node-title" x={position.x - 103} y={position.y - 2}>{item.title.length > 25 ? `${item.title.slice(0, 24)}…` : item.title}</text>
                  <text className="knowledge-graph-node-category" x={position.x - 103} y={position.y + 16}>{item.category.replace(/^(Memory|Document) · /, "") || (item.graphType === "memory" ? "Memory" : "Document")}</text>
                  <title>{item.title}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {moreAvailable && <small className="knowledge-graph-limit">Ansicht begrenzt. Suche oder Filter eingrenzen, um weitere Knoten einzublenden.</small>}
      <small className="knowledge-graph-hint">Klicke einen Knoten an, um den Eintrag zu öffnen und zu bearbeiten.</small>
    </section>
  );
}

const sakuraBlossoms = [
  [3, 13, 22, -5], [7, 22, 29, -12], [11, 15, 24, -17],
  [16, 29, 34, -9], [20, 11, 19, -14], [25, 19, 27, -22],
  [29, 14, 23, -3], [34, 24, 31, -19], [39, 12, 21, -10],
  [44, 27, 32, -26], [48, 16, 25, -15], [52, 12, 20, -4],
  [56, 21, 28, -21], [61, 15, 24, -11], [66, 30, 36, -31],
  [70, 12, 20, -13], [74, 20, 27, -6], [79, 15, 25, -22],
  [83, 25, 33, -16], [87, 11, 21, -8], [92, 19, 29, -24],
  [96, 14, 23, -12]
];

function SakuraBackground() {
  return (
    <div className="sakura-background" aria-hidden="true">
      {sakuraBlossoms.map(([left, size, duration, delay]) => (
        <span className="sakura-blossom" key={left} style={{
          left: `${left}%`, width: size, height: size,
          animationDuration: `${duration}s`, animationDelay: `${delay}s`
        }} />
      ))}
    </div>
  );
}

function DesktopClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [hours, minutes] = time.split(":");
  const date = now.toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="desktop-clock">
      <time dateTime={time} aria-label={time}>
        <span aria-hidden="true">{hours}</span>
        <span aria-hidden="true">{minutes}</span>
      </time>
      <p>{date}</p>
    </div>
  );
}

declare global {
  interface Window {
    unfeal: {
      updates: { check: () => Promise<UpdateStatus>; install: (version: string) => Promise<void> };
      workspace: {
        choose: () => Promise<string | null>;
        files: (root: string) => Promise<Array<{ name: string; content: string }> | null>;
      };
      app: { openExternal: (url: string) => Promise<boolean> };
      projects: {
        list: () => Promise<Project[]>;
        create: (project: { name: string; description: string }) => Promise<Project>;
        delete: (id: string) => Promise<Project[]>;
      };
      ollama: {
        list: () => Promise<{ models: OllamaModel[] }>;
      };
      huggingface: {
        searchGGUF: (query: string) => Promise<HuggingFaceModel[]>;
        listGGUFFiles: (repoId: string) => Promise<HuggingFaceGGUFFile[]>;
      };
      providers: {
        chat: (request: { provider: ChatProvider; model: string; messages: ChatMessage[] }) => Promise<{ message?: { role?: string; content?: string } }>;
        models: (providerId: ChatProvider) => Promise<RemoteModel[]>;
        credentials: {
          status: (providerId: RemoteChatProvider) => Promise<{ configured: boolean; encryptionAvailable: boolean }>;
          save: (providerId: RemoteChatProvider, apiKey: string) => Promise<boolean>;
          remove: (providerId: RemoteChatProvider) => Promise<boolean>;
        };
        streamChat: (request: { provider: ChatProvider; model: string; messages: ChatMessage[]; workspaceFiles?: Array<{ name: string; content: string }>; multiAgent?: boolean; agentIds?: AgentRoleId[]; agentProviders?: AgentProviderSelections; agentModels?: AgentModelSelections; includeKnowledge?: boolean; agentRounds?: number; maxCalls?: number }, onChunk: (delta: string) => void, onProgress?: (status: string) => void) => Promise<{ cancelled?: boolean }>;
        cancelChat: () => void;
      };
      chats: {
        list: (limit?: number) => Promise<ChatSession[]>;
        search: (query: string, limit?: number) => Promise<ChatSession[]>;
        get: (id: string) => Promise<StoredChat | null>;
        summarize: (id: string) => Promise<boolean>;
        saveTurn: (turn: { id?: string; model: string; messages: [ChatMessage, ChatMessage] }) => Promise<Omit<ChatSession, "message_count">>;
        exportMarkdown: (payload: { title: string; model: string; messages: ChatMessage[] }) => Promise<string | null>;
        delete: (id: string) => Promise<boolean>;
        rename: (id: string, title: string) => Promise<Omit<ChatSession, "message_count">>;
      };
      knowledge: {
        search: (query: string) => Promise<KnowledgeSearchResult[]>;
        history: { list: (limit?: number) => Promise<KnowledgeHistoryEvent[]> };
        outbox: { list: (limit?: number) => Promise<KnowledgeOutboxItem[]> };
        backup: { export: () => Promise<string | null>; restore: () => Promise<KnowledgeRestoreSummary | null> };
        vault: { sync: () => Promise<KnowledgeVaultSync> };
        memories: {
          list: () => Promise<KnowledgeItem[]>;
          create: (item: KnowledgeInput) => Promise<KnowledgeItem>;
          update: (id: string, item: Partial<KnowledgeInput>) => Promise<KnowledgeItem>;
          delete: (id: string) => Promise<boolean>;
        };
        documents: {
          list: () => Promise<KnowledgeItem[]>;
          create: (item: KnowledgeInput) => Promise<KnowledgeItem>;
          update: (id: string, item: Partial<KnowledgeInput>) => Promise<KnowledgeItem>;
          delete: (id: string) => Promise<boolean>;
          importMarkdown: () => Promise<{ imported: number; skipped: number }>;
          exportMarkdown: (item: { title: string; content: string }) => Promise<string | null>;
        };
        relations: {
          list: () => Promise<KnowledgeRelation[]>;
          create: (relation: { sourceType: KnowledgeEntityType; sourceId: string; targetType: KnowledgeEntityType; targetId: string; relationType: string }) => Promise<KnowledgeRelation>;
          update: (id: string, relation: { sourceType: KnowledgeEntityType; sourceId: string; targetType: KnowledgeEntityType; targetId: string; relationType: string }) => Promise<KnowledgeRelation>;
          delete: (id: string) => Promise<boolean>;
        };
      };
    };
  }
}

export default function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [message, setMessage] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectError, setProjectError] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [huggingFaceQuery, setHuggingFaceQuery] = useState("");
  const [huggingFaceModels, setHuggingFaceModels] = useState<HuggingFaceModel[]>([]);
  const [huggingFaceLoading, setHuggingFaceLoading] = useState(false);
  const [huggingFaceError, setHuggingFaceError] = useState("");
  const [huggingFaceSelectedRepo, setHuggingFaceSelectedRepo] = useState("");
  const [huggingFaceFiles, setHuggingFaceFiles] = useState<HuggingFaceGGUFFile[]>([]);
  const [huggingFaceFilesLoading, setHuggingFaceFilesLoading] = useState(false);
  const [huggingFaceFilesError, setHuggingFaceFilesError] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollChatRef = useRef(true);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const chatListRequestRef = useRef(0);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatModel, setChatModel] = useState("");
  const [chatProvider, setChatProvider] = useState<ChatProvider>("ollama");
  const [jarvisMode, setJarvisMode] = useState(false);
  const [multiAgentMode, setMultiAgentMode] = useState(false);
  const [agentRoleIds, setAgentRoleIds] = useState<AgentRoleId[]>(["researcher", "developer", "security"]);
  const [agentProviderSelections, setAgentProviderSelections] = useState<AgentProviderSelections>({});
  const [agentModelSelections, setAgentModelSelections] = useState<AgentModelSelections>({});
  const [includeKnowledge, setIncludeKnowledge] = useState(false);
  const [systemPanel, setSystemPanel] = useState(() => {
    const saved = localStorage.getItem("unfeal-system-panel");
    return saved === "standard" || saved === "hidden" ? saved : "compact";
  });
  const [systemCards, setSystemCards] = useState(() => ({
    engine: localStorage.getItem("unfeal-system-card-engine") !== "false",
    application: localStorage.getItem("unfeal-system-card-application") !== "false",
    environment: localStorage.getItem("unfeal-system-card-environment") !== "false"
  }));
  const [autoKnowledge, setAutoKnowledge] = useState(() => localStorage.getItem("unfeal-auto-knowledge") === "true");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [autoKnowledgeStatus, setAutoKnowledgeStatus] = useState("");
  const agentCount = agentRoleIds.length;
  const [agentRounds, setAgentRounds] = useState(1);
  const [maxAgentCalls, setMaxAgentCalls] = useState(5);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [agentModelCatalogs, setAgentModelCatalogs] = useState<Record<ChatProvider, RemoteModel[]>>({ ollama: [], anthropic: [], openai: [], gemini: [], openrouter: [] });
  const [agentModelErrors, setAgentModelErrors] = useState<Partial<Record<ChatProvider, string>>>({});
  const [agentModelLoading, setAgentModelLoading] = useState<Partial<Record<ChatProvider, boolean>>>({});
  const agentModelLoadingRef = useRef(new Set<ChatProvider>());
  const agentModelLoadedRef = useRef(new Set<ChatProvider>());
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [anthropicKeyStatus, setAnthropicKeyStatus] = useState({ configured: false, encryptionAvailable: false });
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [openaiKeyStatus, setOpenaiKeyStatus] = useState({ configured: false, encryptionAvailable: false });
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiKeyStatus, setGeminiKeyStatus] = useState({ configured: false, encryptionAvailable: false });
  const [openrouterKeyInput, setOpenrouterKeyInput] = useState("");
  const [openrouterKeyStatus, setOpenrouterKeyStatus] = useState({ configured: false, encryptionAvailable: false });
  const [providerSettingsNotice, setProviderSettingsNotice] = useState("");
  const [providerSettingsError, setProviderSettingsError] = useState("");
  const [savingProviderKey, setSavingProviderKey] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatProgress, setChatProgress] = useState<string[]>([]);
  const [chatError, setChatError] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [knowledgeType, setKnowledgeType] = useState<"memory" | "document" | "relation" | "graph" | "history">("memory");
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [knowledgeHistory, setKnowledgeHistory] = useState<KnowledgeHistoryEvent[]>([]);
  const [pendingSync, setPendingSync] = useState<KnowledgeOutboxItem[]>([]);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [knowledgeCategory, setKnowledgeCategory] = useState("");
  const [editingKnowledgeId, setEditingKnowledgeId] = useState<string | null>(null);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [relationItems, setRelationItems] = useState<KnowledgeItem[]>([]);
  const [relations, setRelations] = useState<KnowledgeRelation[]>([]);
  const [relationSourceType, setRelationSourceType] = useState<KnowledgeEntityType>("memory");
  const [relationSourceId, setRelationSourceId] = useState("");
  const [relationTargetType, setRelationTargetType] = useState<KnowledgeEntityType>("document");
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationLabel, setRelationLabel] = useState("");
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null);
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState("");
  const [knowledgeSearchResults, setKnowledgeSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [knowledgeSearchError, setKnowledgeSearchError] = useState("");
  const [knowledgeSearchComplete, setKnowledgeSearchComplete] = useState(false);
  const [searchingKnowledge, setSearchingKnowledge] = useState(false);
  const [knowledgeVaultStatus, setKnowledgeVaultStatus] = useState("");

  function agentProviderFor(roleId: AgentRoleId) {
    return agentProviderSelections[roleId] || chatProvider;
  }

  function modelsForProvider(provider: ChatProvider): RemoteModel[] {
    if (provider === chatProvider) {
      return provider === "ollama" ? models.map((model) => ({ id: model.name, name: model.name })) : remoteModels;
    }
    return agentModelCatalogs[provider];
  }

  function agentModelFor(roleId: AgentRoleId) {
    const provider = agentProviderFor(roleId);
    return agentModelSelections[roleId] || (provider === chatProvider ? chatModel : modelsForProvider(provider)[0]?.id || "");
  }

  async function loadAgentModels(provider: ChatProvider) {
    if (provider === chatProvider || agentModelLoadedRef.current.has(provider) || agentModelLoadingRef.current.has(provider)) return;
    agentModelLoadingRef.current.add(provider);
    setAgentModelLoading((current) => ({ ...current, [provider]: true }));
    try {
      let options: RemoteModel[];
      if (provider === "ollama") {
        const response = await window.unfeal.ollama.list();
        options = (Array.isArray(response.models) ? response.models : []).map((model) => ({ id: model.name, name: model.name }));
      } else {
        options = await window.unfeal.providers.models(provider);
      }
      agentModelLoadedRef.current.add(provider);
      setAgentModelCatalogs((current) => ({ ...current, [provider]: options }));
      setAgentModelErrors((current) => { const next = { ...current }; delete next[provider]; return next; });
    } catch (error) {
      console.error(error);
      setAgentModelErrors((current) => ({ ...current, [provider]: provider === "ollama" ? "Ollama-Modelle nicht verfügbar" : `${chatProviderNames[provider]}-Schlüssel oder Modellzugriff prüfen` }));
    } finally {
      agentModelLoadingRef.current.delete(provider);
      setAgentModelLoading((current) => ({ ...current, [provider]: false }));
    }
  }

  function updateMaxAgentCalls(value: number) {
    const safeBudget = Math.max(3, Math.min(13, Math.trunc(value)));
    const safeTeamSize = Math.min(agentRoleIds.length, safeBudget - 1);
    setMaxAgentCalls(safeBudget);
    setAgentRoleIds((current) => current.slice(0, safeTeamSize));
    setAgentRounds((current) => Math.min(current, Math.max(1, Math.floor((safeBudget - 1) / safeTeamSize))));
  }

  function toggleAgentRole(roleId: AgentRoleId, checked: boolean) {
    setAgentRoleIds((current) => {
      if (checked) {
        if (current.includes(roleId) || current.length >= agentRoles.length ||
            (current.length + 1) * agentRounds + 1 > maxAgentCalls) return current;
        return [...current, roleId];
      }
      return current.length > 2 ? current.filter((id) => id !== roleId) : current;
    });
  }

  async function loadKnowledge() {
    setLoadingKnowledge(true);
    setKnowledgeError("");
    try {
      if (knowledgeType === "history") {
        const [history, outbox] = await Promise.all([
          window.unfeal.knowledge.history.list(),
          window.unfeal.knowledge.outbox.list()
        ]);
        setKnowledgeHistory(history);
        setPendingSync(outbox);
        setKnowledgeItems([]);
        return;
      }
      if (knowledgeType === "relation" || knowledgeType === "graph") {
        const [memories, documents, links] = await Promise.all([
          window.unfeal.knowledge.memories.list(),
          window.unfeal.knowledge.documents.list(),
          window.unfeal.knowledge.relations.list()
        ]);
        setRelationItems([
          ...memories.map((item) => ({ ...item, category: `Memory · ${item.category}` })),
          ...documents.map((item) => ({ ...item, category: `Document · ${item.category}` }))
        ]);
        setRelations(links);
        setKnowledgeItems([]);
        const sourceItems = relationSourceType === "memory" ? memories : documents;
        const targetItems = relationTargetType === "memory" ? memories : documents;
        setRelationSourceId((current) => sourceItems.some((item) => item.id === current) ? current : sourceItems[0]?.id || "");
        setRelationTargetId((current) => targetItems.some((item) => item.id === current) ? current : targetItems[0]?.id || "");
        return;
      }
      const api = knowledgeType === "memory"
        ? window.unfeal.knowledge.memories
        : window.unfeal.knowledge.documents;
      setKnowledgeItems(await api.list());
    } catch (error) {
      console.error(error);
      setKnowledgeError("Knowledge-Daten konnten nicht geladen werden.");
    } finally {
      setLoadingKnowledge(false);
    }
  }

  function resetKnowledgeForm() {
    setEditingKnowledgeId(null);
    setKnowledgeTitle("");
    setKnowledgeContent("");
    setKnowledgeCategory("");
    setEditingRelationId(null);
    setRelationLabel("");
  }

  async function saveRelation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const relation = {
        sourceType: relationSourceType,
        sourceId: relationSourceId,
        targetType: relationTargetType,
        targetId: relationTargetId,
        relationType: relationLabel
      };
      if (editingRelationId) await window.unfeal.knowledge.relations.update(editingRelationId, relation);
      else await window.unfeal.knowledge.relations.create(relation);
      setEditingRelationId(null);
      setRelationLabel("");
      await loadKnowledge();
    } catch (error) {
      console.error(error);
      setKnowledgeError("Verbindung konnte nicht gespeichert werden. Prüfe Einträge und Bezeichnung.");
    }
  }

  async function deleteRelation(id: string) {
    if (!window.confirm("Möchtest du diese Verbindung wirklich löschen?")) return;
    try {
      await window.unfeal.knowledge.relations.delete(id);
      if (editingRelationId === id) {
        setEditingRelationId(null);
        setRelationLabel("");
      }
      await loadKnowledge();
    } catch (error) {
      console.error(error);
      setKnowledgeError("Verbindung konnte nicht gelöscht werden.");
    }
  }

  async function searchKnowledge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchingKnowledge(true);
    setKnowledgeSearchError("");
    setKnowledgeSearchComplete(false);
    try {
      setKnowledgeSearchResults(await window.unfeal.knowledge.search(knowledgeSearchQuery));
      setKnowledgeSearchComplete(true);
    } catch (error) {
      console.error(error);
      setKnowledgeSearchError("Die Knowledge-Suche ist fehlgeschlagen.");
    } finally {
      setSearchingKnowledge(false);
    }
  }

  async function refreshKnowledge() {
    setKnowledgeError("");
    setKnowledgeVaultStatus("");
    try {
      const result = await window.unfeal.knowledge.vault.sync();
      if (result.conflicts > 0) {
        setKnowledgeVaultStatus(`Vault geprüft: ${result.imported} Änderungen übernommen, ${result.restored} Dateien wiederhergestellt. ${result.conflicts} Datei(en) mit ungültigem Frontmatter blieben unverändert.`);
      } else if (result.imported + result.restored === 0) {
        setKnowledgeVaultStatus(`Vault ist aktuell. ${result.checked} Dokument(e) geprüft.`);
      } else {
        setKnowledgeVaultStatus(`Vault aktualisiert: ${result.imported} Änderung(en) übernommen, ${result.restored} Datei(en) wiederhergestellt.`);
      }
      await loadKnowledge();
    } catch (error) {
      console.error(error);
      setKnowledgeError("Der Markdown-Vault konnte nicht synchronisiert werden.");
    }
  }

  async function exportKnowledgeBackup() {
    setKnowledgeError("");
    setKnowledgeVaultStatus("");
    try {
      const destination = await window.unfeal.knowledge.backup.export();
      if (destination) setKnowledgeVaultStatus(`Knowledge-Backup erstellt: ${destination}`);
    } catch (error) {
      console.error(error);
      setKnowledgeError("Knowledge-Backup konnte nicht erstellt werden.");
    }
  }

  async function restoreKnowledgeBackup() {
    setKnowledgeError("");
    setKnowledgeVaultStatus("");
    try {
      const result = await window.unfeal.knowledge.backup.restore();
      if (!result) return;
      setKnowledgeVaultStatus(`Backup zusammengeführt: ${result.memories} Memories, ${result.documents} Dokumente, ${result.relations} Verbindungen und ${result.chats} Chats mit ${result.chatMessages} Nachrichten ergänzt. ${result.historyEvents} Verlaufseinträge und ${result.outboxEntries} Outbox-Einträge übernommen; ${result.conflicts} Konflikt(e) übersprungen.`);
      await loadKnowledge();
    } catch (error) {
      console.error(error);
      setKnowledgeError("Backup konnte nicht geprüft oder zusammengeführt werden.");
    }
  }

  function openSearchResult(item: KnowledgeSearchResult) {
    setKnowledgeType(item.type);
    setEditingKnowledgeId(item.id);
    setKnowledgeTitle(item.title);
    setKnowledgeContent(item.content);
    setKnowledgeCategory(item.category);
  }

  function openGraphNode(item: KnowledgeGraphNode) {
    setKnowledgeType(item.graphType);
    setEditingKnowledgeId(item.id);
    setKnowledgeTitle(item.title);
    setKnowledgeContent(item.content);
    setKnowledgeCategory(item.category.replace(/^(Memory|Document) · /, ""));
    setKnowledgeError("");
  }

  function openGraphRelation(relation: KnowledgeRelation) {
    setKnowledgeType("relation");
    setEditingRelationId(relation.id);
    setRelationSourceType(relation.source_type);
    setRelationSourceId(relation.source_id);
    setRelationTargetType(relation.target_type);
    setRelationTargetId(relation.target_id);
    setRelationLabel(relation.relation_type);
    setKnowledgeError("");
  }

  async function saveKnowledge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const api = knowledgeType === "memory"
      ? window.unfeal.knowledge.memories
      : window.unfeal.knowledge.documents;
    try {
      const item = {
        title: knowledgeTitle,
        content: knowledgeContent,
        category: knowledgeCategory
      };
      if (editingKnowledgeId) await api.update(editingKnowledgeId, item);
      else await api.create(item);
      resetKnowledgeForm();
      await loadKnowledge();
    } catch (error) {
      console.error(error);
      setKnowledgeError("Eintrag konnte nicht gespeichert werden. Prüfe Titel und Länge.");
    }
  }

  async function deleteKnowledge(id: string) {
    const api = knowledgeType === "memory"
      ? window.unfeal.knowledge.memories
      : window.unfeal.knowledge.documents;
    try {
      await api.delete(id);
      if (editingKnowledgeId === id) resetKnowledgeForm();
      await loadKnowledge();
    } catch (error) {
      console.error(error);
      setKnowledgeError("Eintrag konnte nicht gelöscht werden.");
    }
  }

  async function importMarkdownDocuments() {
    setKnowledgeError("");
    try {
      const result = await window.unfeal.knowledge.documents.importMarkdown();
      setKnowledgeVaultStatus(`${result.imported} Markdown-Dokument(e) importiert${result.skipped ? `, ${result.skipped} übersprungen` : ""}.`);
      await loadKnowledge();
    } catch (error) {
      console.error(error);
      setKnowledgeError("Markdown-Dateien konnten nicht importiert werden.");
    }
  }

  async function exportMarkdownDocument(item: KnowledgeItem) {
    setKnowledgeError("");
    try {
      const savedPath = await window.unfeal.knowledge.documents.exportMarkdown({ title: item.title, content: item.content });
      if (savedPath) setKnowledgeVaultStatus(`Markdown gespeichert: ${savedPath}`);
    } catch (error) {
      console.error(error);
      setKnowledgeError("Markdown-Dokument konnte nicht exportiert werden.");
    }
  }

  async function loadProjects() {
    setLoadingProjects(true);
    setProjectError("");

    try {
      const result = await window.unfeal.projects.list();
      setProjects(result);
    } catch (error) {
      console.error(error);
      setProjectError("Projekte konnten nicht geladen werden. Bitte starte UNFEAL OS neu.");
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadModels() {
    setLoadingModels(true);
    setModelsError("");

    try {
      if (chatProvider !== "ollama") {
        const status = await window.unfeal.providers.credentials.status(chatProvider);
        if (chatProvider === "anthropic") setAnthropicKeyStatus(status);
        else if (chatProvider === "openai") setOpenaiKeyStatus(status);
        else if (chatProvider === "gemini") setGeminiKeyStatus(status);
        else setOpenrouterKeyStatus(status);
        if (!status.configured) {
          setRemoteModels([]);
          setChatModel("");
          setModelsError(`${chatProviderNames[chatProvider]} benötigt einen API-Schlüssel. Richte ihn unter Settings ein.`);
          return;
        }
        const availableModels = await window.unfeal.providers.models(chatProvider);
        setRemoteModels(availableModels);
        setChatModel((current) => availableModels.some((model) => model.id === current) ? current : availableModels[0]?.id || "");
        return;
      }
      const result = await window.unfeal.ollama.list();
      const availableModels = Array.isArray(result.models) ? result.models : [];
      setModels(availableModels);
      setRemoteModels([]);
      setChatModel((current) => availableModels.some((model) => model.name === current) ? current : availableModels[0]?.name || "");
    } catch (error) {
      console.error(error);
      setModelsError(chatProvider === "ollama" ? "Ollama-Modelle konnten nicht geladen werden. Ist Ollama gestartet?" : `${chatProviderNames[chatProvider]}-Modelle konnten nicht geladen werden. Prüfe API-Schlüssel, Internetverbindung und API-Zugriff.`);
    } finally {
      setLoadingModels(false);
    }
  }

  async function searchHuggingFaceModels(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (huggingFaceQuery.trim().length < 2) {
      setHuggingFaceError("Gib mindestens zwei Zeichen ein.");
      return;
    }
    setHuggingFaceLoading(true);
    setHuggingFaceError("");
    setHuggingFaceModels([]);
    setHuggingFaceSelectedRepo("");
    setHuggingFaceFiles([]);
    try {
      setHuggingFaceModels(await window.unfeal.huggingface.searchGGUF(huggingFaceQuery));
    } catch (error) {
      console.error(error);
      setHuggingFaceError("Hugging Face konnte nicht durchsucht werden. Prüfe die Internetverbindung und versuche es erneut.");
    } finally {
      setHuggingFaceLoading(false);
    }
  }

  async function loadHuggingFaceFiles(repoId: string) {
    setHuggingFaceSelectedRepo(repoId);
    setHuggingFaceFiles([]);
    setHuggingFaceFilesError("");
    setHuggingFaceFilesLoading(true);
    try {
      setHuggingFaceFiles(await window.unfeal.huggingface.listGGUFFiles(repoId));
    } catch (error) {
      console.error(error);
      setHuggingFaceFilesError("GGUF-Dateien konnten nicht geladen werden. Das Repository ist möglicherweise geschützt.");
    } finally {
      setHuggingFaceFilesLoading(false);
    }
  }

  function formatFileSize(size: number | null) {
    if (size === null || !Number.isFinite(size)) return "Größe unbekannt";
    if (size < 1024) return `${size} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = size / 1024;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
    return `${value.toFixed(1)} ${units[index]}`;
  }

  async function loadAnthropicCredentialStatus() {
    try {
      setAnthropicKeyStatus(await window.unfeal.providers.credentials.status("anthropic"));
      setProviderSettingsError("");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der Schlüsselstatus konnte nicht geladen werden.");
    }
  }

  async function saveAnthropicApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!anthropicKeyInput.trim()) return;
    setSavingProviderKey(true);
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.save("anthropic", anthropicKeyInput);
      setAnthropicKeyInput("");
      await loadAnthropicCredentialStatus();
      setProviderSettingsNotice("Anthropic API-Schlüssel sicher gespeichert.");
      if (chatProvider === "anthropic") await loadModels();
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der Schlüssel konnte nicht sicher gespeichert werden.");
    } finally {
      setSavingProviderKey(false);
    }
  }

  async function removeAnthropicApiKey() {
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.remove("anthropic");
      setRemoteModels([]);
      setChatModel(chatProvider === "anthropic" ? "" : chatModel);
      await loadAnthropicCredentialStatus();
      setProviderSettingsNotice("Anthropic API-Schlüssel entfernt.");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der Schlüssel konnte nicht entfernt werden.");
    }
  }

  async function loadOpenaiCredentialStatus() {
    try {
      setOpenaiKeyStatus(await window.unfeal.providers.credentials.status("openai"));
      setProviderSettingsError("");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der OpenAI-Schlüsselstatus konnte nicht geladen werden.");
    }
  }

  async function saveOpenaiApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openaiKeyInput.trim()) return;
    setSavingProviderKey(true);
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.save("openai", openaiKeyInput);
      setOpenaiKeyInput("");
      await loadOpenaiCredentialStatus();
      setProviderSettingsNotice("OpenAI API-Schlüssel sicher gespeichert.");
      if (chatProvider === "openai") await loadModels();
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der OpenAI-Schlüssel konnte nicht sicher gespeichert werden.");
    } finally {
      setSavingProviderKey(false);
    }
  }

  async function removeOpenaiApiKey() {
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.remove("openai");
      setRemoteModels([]);
      setChatModel(chatProvider === "openai" ? "" : chatModel);
      await loadOpenaiCredentialStatus();
      setProviderSettingsNotice("OpenAI API-Schlüssel entfernt.");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der OpenAI-Schlüssel konnte nicht entfernt werden.");
    }
  }

  async function loadGeminiCredentialStatus() {
    try {
      setGeminiKeyStatus(await window.unfeal.providers.credentials.status("gemini"));
      setProviderSettingsError("");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der Gemini-Schlüsselstatus konnte nicht geladen werden.");
    }
  }

  async function saveGeminiApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!geminiKeyInput.trim()) return;
    setSavingProviderKey(true);
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.save("gemini", geminiKeyInput);
      setGeminiKeyInput("");
      await loadGeminiCredentialStatus();
      setProviderSettingsNotice("Google Gemini API-Schlüssel sicher gespeichert.");
      if (chatProvider === "gemini") await loadModels();
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der Gemini-Schlüssel konnte nicht sicher gespeichert werden.");
    } finally {
      setSavingProviderKey(false);
    }
  }

  async function removeGeminiApiKey() {
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.remove("gemini");
      setRemoteModels([]);
      setChatModel(chatProvider === "gemini" ? "" : chatModel);
      await loadGeminiCredentialStatus();
      setProviderSettingsNotice("Gemini API-Schlüssel entfernt.");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der Gemini-Schlüssel konnte nicht entfernt werden.");
    }
  }

  async function loadOpenrouterCredentialStatus() {
    try {
      setOpenrouterKeyStatus(await window.unfeal.providers.credentials.status("openrouter"));
      setProviderSettingsError("");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der OpenRouter-Schlüsselstatus konnte nicht geladen werden.");
    }
  }

  async function saveOpenrouterApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openrouterKeyInput.trim()) return;
    setSavingProviderKey(true);
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.save("openrouter", openrouterKeyInput);
      setOpenrouterKeyInput("");
      await loadOpenrouterCredentialStatus();
      setProviderSettingsNotice("OpenRouter API-Schlüssel sicher gespeichert.");
      if (chatProvider === "openrouter") await loadModels();
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der OpenRouter-Schlüssel konnte nicht sicher gespeichert werden.");
    } finally {
      setSavingProviderKey(false);
    }
  }

  async function removeOpenrouterApiKey() {
    setProviderSettingsError("");
    setProviderSettingsNotice("");
    try {
      await window.unfeal.providers.credentials.remove("openrouter");
      if (chatProvider === "openrouter") {
        setRemoteModels([]);
        setChatModel("");
      }
      await loadOpenrouterCredentialStatus();
      setProviderSettingsNotice("OpenRouter API-Schlüssel entfernt.");
    } catch (error) {
      console.error(error);
      setProviderSettingsError("Der OpenRouter-Schlüssel konnte nicht entfernt werden.");
    }
  }

  async function loadChats() {
    const requestId = ++chatListRequestRef.current;
    try {
      const query = chatSearch.trim();
      const sessions = query ? await window.unfeal.chats.search(query, 40) : await window.unfeal.chats.list(40);
      if (requestId === chatListRequestRef.current) setChatSessions(sessions);
    } catch (error) {
      console.error(error);
      setChatError("Gespeicherte Chats konnten nicht geladen werden.");
    }
  }

  function clearWorkspace() {
    setWorkspaceRoot("");
    setWorkspaceFiles([]);
    setWorkspaceError("");
  }

  async function chooseWorkspace() {
    setWorkspaceLoading(true);
    setWorkspaceError("");
    try {
      const root = await window.unfeal.workspace.choose();
      if (root) {
        setWorkspaceRoot(root);
        setWorkspaceFiles([]);
      }
    } catch (error) {
      console.error(error);
      setWorkspaceError("Der Arbeitsordner konnte nicht geöffnet werden.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function chooseWorkspaceFiles() {
    setWorkspaceLoading(true);
    setWorkspaceError("");
    try {
      const files = await window.unfeal.workspace.files(workspaceRoot);
      if (files) setWorkspaceFiles(files);
    } catch (error) {
      console.error(error);
      setWorkspaceError("Wähle bis zu vier lesbare UTF-8-Textdateien aus dem Arbeitsordner (insgesamt höchstens 48 KB).");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function openChat(id: string) {
    if (chatLoading) return;
    setChatError("");
    try {
      const chat = await window.unfeal.chats.get(id);
      if (!chat) {
        setChatError("Dieser Chat wurde nicht gefunden.");
        await loadChats();
        return;
      }
      if (id !== chatId) clearWorkspace();
      setChatId(chat.id);
      const savedModel = parseChatModel(chat.model);
      setMultiAgentMode(savedModel.multiAgent);
      setAgentRoleIds(savedModel.agentRoleIds);
      setAgentProviderSelections(savedModel.agentProviderSelections);
      setAgentModelSelections(savedModel.agentModelSelections);
      setIncludeKnowledge(savedModel.includeKnowledge);
      setAgentRounds(savedModel.agentRounds);
      setMaxAgentCalls(savedModel.maxAgentCalls);
      setChatProvider(savedModel.provider);
      setChatModel(savedModel.model);
      setChatMessages(chat.messages.map(({ role, content }) => ({ role, content })));
      setMessage("");
      setActivePage("AI Chat");
    } catch (error) {
      console.error(error);
      setChatError("Chat konnte nicht geöffnet werden.");
    }
  }

  async function deleteChat(id: string) {
    const chat = chatSessions.find((item) => item.id === id);
    if (!window.confirm(`Diesen Chat${chat?.title ? ` „${chat.title}“` : ""} und seine Nachrichten löschen?`)) return;
    try {
      await window.unfeal.chats.delete(id);
      setChatSessions((current) => current.filter((item) => item.id !== id));
      if (chatId === id) {
        clearWorkspace();
        setChatId(null);
        setChatMessages([]);
        setMessage("");
      }
    } catch (error) {
      console.error(error);
      setChatError("Chat konnte nicht gelöscht werden.");
    }
  }

  async function renameChat(id: string) {
    const chat = chatSessions.find((item) => item.id === id);
    if (!chat) return;
    const title = window.prompt("Chat umbenennen:", chat.title);
    if (title === null || !title.trim()) return;
    try {
      await window.unfeal.chats.rename(id, title.trim());
      await loadChats();
    } catch (error) {
      console.error(error);
      setChatError("Chat konnte nicht umbenannt werden. Der Name darf höchstens 80 Zeichen lang sein.");
    }
  }

  async function exportCurrentChat() {
    if (chatMessages.length === 0) return;
    const title = chatSessions.find((chat) => chat.id === chatId)?.title || chatMessages.find((item) => item.role === "user")?.content.slice(0, 60) || "UNFEAL Chat";
    try {
      const savedPath = await window.unfeal.chats.exportMarkdown({ title, model: `${multiAgentMode ? `Multi-Agent · ${agentCount} Agenten · ${agentRounds} Runden · ` : ""}${chatProviderNames[chatProvider]} · ${chatModel || ""}`, messages: chatMessages });
      setChatNotice(savedPath ? "Chat als Markdown gespeichert." : "");
      setChatError("");
    } catch (error) {
      console.error(error);
      setChatNotice("");
      setChatError("Chat konnte nicht exportiert werden.");
    }
  }

  async function sendChatMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.trim();
    if (!content || chatLoading) return;
    if (!chatModel) {
      setChatError(chatProvider === "ollama" ? "Wähle zuerst ein verfügbares Ollama-Modell aus." : `Wähle zuerst ein verfügbares ${chatProviderNames[chatProvider]}-Modell aus.`);
      return;
    }
    const missingAgentModel = multiAgentMode && agentRoleIds.find((id) => {
      const provider = agentProviderFor(id);
      const selectedModel = agentModelFor(id);
      return !selectedModel || !modelsForProvider(provider).some((model) => model.id === selectedModel);
    });
    if (missingAgentModel) {
      setChatError(`Wähle ein Modell für ${agentRoles.find((agent) => agent.id === missingAgentModel)?.label || missingAgentModel}.`);
      return;
    }
    const userMessage: ChatMessage = { role: "user", content };
    const outgoingAgentProviders: AgentProviderSelections = {};
    const outgoingAgentModels: AgentModelSelections = {};
    if (multiAgentMode) {
      for (const id of agentRoleIds) {
        outgoingAgentProviders[id] = agentProviderFor(id);
        outgoingAgentModels[id] = agentModelFor(id);
      }
    }
    shouldAutoScrollChatRef.current = true;
    setChatMessages((current) => [...current, userMessage]);
    setMessage("");
    setChatError("");
    setChatProgress([]);
    setChatLoading(true);
    try {
      const history = [...chatMessages, userMessage].slice(-50);
      let reply = "";
      let completed = false;
      const updateAssistant = (delta: string) => {
        const remaining = 20000 - reply.length;
        if (remaining <= 0) return;
        reply += delta.slice(0, remaining);
        setChatMessages((current) => [...current.slice(0, -1), { role: "assistant", content: reply }]);
      };
      setChatMessages((current) => [...current, { role: "assistant", content: "" }]);
      try {
        const streamResult = await window.unfeal.providers.streamChat({
          provider: chatProvider,
          model: chatModel,
          messages: history,
          includeKnowledge,
          ...(!multiAgentMode && workspaceFiles.length ? { workspaceFiles } : {}),
          ...(multiAgentMode ? { multiAgent: true, agentIds: agentRoleIds, agentProviders: outgoingAgentProviders, agentModels: outgoingAgentModels, includeKnowledge, agentRounds, maxCalls: maxAgentCalls } : {})
        }, updateAssistant, (status) => setChatProgress((current) => [...current.slice(-4), status]));
        if (streamResult.cancelled && !reply.trim()) {
          setChatMessages((current) => current.slice(0, -2));
          setChatError(multiAgentMode ? "Agentenrunde wurde gestoppt." : "Antwort wurde gestoppt.");
          return;
        }
        completed = !streamResult.cancelled;
        if (!reply.trim()) throw new Error("The provider returned no assistant message.");
      } catch (error) {
        console.error(error);
        if (!reply.trim()) {
          setChatMessages((current) => current.slice(0, -2));
          setMessage(content);
          setChatError(multiAgentMode ? "Das Agenten-Team konnte nicht antworten. Prüfe Modell, Schlüssel und API-Zugriff." : chatProvider === "ollama" ? "Ollama konnte nicht antworten. Prüfe, ob Ollama läuft und das Modell verfügbar ist." : `${chatProviderNames[chatProvider]} konnte nicht antworten. Prüfe API-Schlüssel, Modellzugriff und API-Guthaben.`);
          return;
        }
      }
      const assistantMessage: ChatMessage = { role: "assistant", content: reply };
      setChatMessages((current) => [...current.slice(0, -1), assistantMessage]);
      try {
        const saved = await window.unfeal.chats.saveTurn({
          ...(chatId ? { id: chatId } : {}),
          model: multiAgentMode
            ? `multi-config:${encodeURIComponent(JSON.stringify({ agentRoleIds, agentProviderSelections: outgoingAgentProviders, agentModelSelections: outgoingAgentModels, includeKnowledge, agentRounds, maxAgentCalls, provider: chatProvider, model: chatModel }))}`
            : `${chatProvider}:${chatModel}`,
          messages: [userMessage, assistantMessage]
        });
        setChatId(saved.id);
        if (autoKnowledge && !multiAgentMode && completed) {
          void window.unfeal.chats.summarize(saved.id).then((updated) => {
            if (updated) setAutoKnowledgeStatus("Knowledge-Memory aus dem Chat aktualisiert.");
          }).catch((error) => {
            console.error(error);
            setAutoKnowledgeStatus("Das Chatwissen konnte nicht aktualisiert werden.");
          });
        }
        await loadChats();
      } catch (error) {
        console.error(error);
        setChatMessages((current) => current.slice(0, -2));
        setMessage(content);
        setChatError("Die Antwort kam an, konnte aber nicht lokal gespeichert werden.");
      }
    } finally {
      setChatLoading(false);
    }
  }
  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const messagesElement = chatMessagesRef.current;
    if (messagesElement && shouldAutoScrollChatRef.current) {
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (activePage === "AI Chat") {
      loadModels();
    }
  }, [activePage, chatProvider]);

  useEffect(() => {
    if (activePage !== "AI Chat" || !multiAgentMode) return;
    const selectedProviders = new Set(agentRoleIds.map((id) => agentProviderSelections[id] || chatProvider));
    for (const provider of selectedProviders) {
      if (provider !== chatProvider) void loadAgentModels(provider);
    }
  }, [activePage, multiAgentMode, chatProvider, agentRoleIds, agentProviderSelections]);

  useEffect(() => {
    if (activePage === "Settings") {
      void loadAnthropicCredentialStatus();
      void loadOpenaiCredentialStatus();
      void loadGeminiCredentialStatus();
      void loadOpenrouterCredentialStatus();
    }
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "AI Chat") return;
    const timer = window.setTimeout(() => { void loadChats(); }, chatSearch.trim() ? 220 : 0);
    return () => { window.clearTimeout(timer); chatListRequestRef.current++; };
  }, [activePage, chatSearch]);

  useEffect(() => {
    if (activePage === "Knowledge") loadKnowledge();
  }, [activePage, knowledgeType]);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim()) return;

    setProjectError("");

    try {
      const project = await window.unfeal.projects.create({
        name: projectName,
        description: projectDescription
      });

      setProjects((current) => [...current, project]);
      setProjectName("");
      setProjectDescription("");
    } catch (error) {
      console.error(error);
      setProjectError("Projekt konnte nicht gespeichert werden.");
    }
  }

  async function deleteProject(id: string) {
    if (!window.confirm("Möchtest du dieses Projekt wirklich löschen?")) return;

    try {
      const updated = await window.unfeal.projects.delete(id);
      setProjects(updated);
      setProjectError("");
    } catch (error) {
      console.error(error);
      setProjectError("Projekt konnte nicht gelöscht werden.");
    }
  }

  const matchingChats = chatSearch.trim() ? chatSessions : chatSessions.slice(0, 8);

  function renderPage() {
    switch (activePage) {
      case "AI Chat":
        return (
          <div className="chat-page">
            <div className="eyebrow">LOCAL AI INTERFACE</div>
            <div className="chat-heading">
              <div><h1>AI <span>Chat</span></h1><p>{chatProvider === "ollama" ? "Unterhaltung mit deinem lokalen Ollama-Modell." : `Unterhaltung mit ${chatProviderNames[chatProvider]} über die API.`}</p></div>
              <div className="chat-model-picker">
                {chatMessages.length > 0 && <button type="button" className="chat-export-button" onClick={exportCurrentChat} disabled={chatLoading}>Exportieren</button>}
                <button type="button" aria-pressed={jarvisMode} onClick={() => setJarvisMode(!jarvisMode)}>JARVIS</button>
                <label htmlFor="chat-provider">PROVIDER</label>
                <select id="chat-provider" value={chatProvider} onChange={(event) => { setChatModel(""); setAgentProviderSelections({}); setAgentModelSelections({}); setChatProvider(event.target.value as ChatProvider); }} disabled={chatLoading}>
                  <option value="ollama">Ollama · lokal</option>
                  <option value="anthropic">Claude · API</option>
                  <option value="openai">OpenAI · API</option>
                  <option value="gemini">Gemini · API</option>
                  <option value="openrouter">OpenRouter · API</option>
                </select>
                <label htmlFor="chat-model">MODELL</label>
                <select id="chat-model" value={chatModel} onChange={(event) => setChatModel(event.target.value)} disabled={loadingModels || (chatProvider === "ollama" ? models.length === 0 : remoteModels.length === 0)}>
                  {chatProvider === "ollama"
                    ? models.length === 0 ? <option value="">Kein Modell verfügbar</option> : models.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)
                    : remoteModels.length === 0 ? <option value="">Kein {chatProviderNames[chatProvider]}-Modell verfügbar</option> : remoteModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                <button type="button" onClick={loadModels} disabled={loadingModels}>{loadingModels ? "Lade …" : "↻"}</button>
                <label className="agent-mode-toggle"><input type="checkbox" checked={multiAgentMode} onChange={(event) => setMultiAgentMode(event.target.checked)} disabled={chatLoading} /> Multi-Agent</label>
                {multiAgentMode && <><fieldset className="agent-role-picker" disabled={chatLoading}><legend>AGENTEN</legend>{agentRoles.map((agent) => {
                  const selected = agentRoleIds.includes(agent.id);
                  const selectedProvider = agentProviderFor(agent.id);
                  const selectedModel = agentModelFor(agent.id);
                  const modelOptions = modelsForProvider(selectedProvider);
                  const modelLoading = selectedProvider === chatProvider ? loadingModels : agentModelLoading[selectedProvider];
                  const modelError = selectedProvider === chatProvider ? modelsError : agentModelErrors[selectedProvider];
                  return <div className="agent-role-config" key={agent.id}>
                    <label><input type="checkbox" checked={selected} onChange={(event) => toggleAgentRole(agent.id, event.target.checked)} disabled={!selected && (agentRoleIds.length >= 4 || (agentRoleIds.length + 1) * agentRounds + 1 > maxAgentCalls)} />{agent.label}</label>
                    {selected && <select className="agent-provider-select" aria-label={`${agent.label} Provider`} value={selectedProvider} onChange={(event) => {
                      const provider = event.target.value as ChatProvider;
                      setAgentProviderSelections((current) => {
                        const next = { ...current };
                        if (provider === chatProvider) delete next[agent.id];
                        else next[agent.id] = provider;
                        return next;
                      });
                      setAgentModelSelections((current) => { const next = { ...current }; delete next[agent.id]; return next; });
                      void loadAgentModels(provider);
                    }} disabled={chatLoading}>
                      <option value="ollama">Ollama · lokal</option><option value="anthropic">Claude</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option>
                    </select>}
                    {selected && <select className="agent-model-select" aria-label={`${agent.label} Modell`} value={selectedModel} onChange={(event) => setAgentModelSelections((current) => {
                      const next = { ...current };
                      if (event.target.value === (selectedProvider === chatProvider ? chatModel : modelOptions[0]?.id)) delete next[agent.id];
                      else next[agent.id] = event.target.value;
                      return next;
                    })} disabled={chatLoading || modelLoading || modelOptions.length === 0}>
                      {modelOptions.length === 0 ? <option value="">{modelLoading ? "Modelle laden …" : "Kein Modell verfügbar"}</option> : modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                    </select>}
                    {selected && modelError && <small className="agent-model-error">{modelError}</small>}
                  </div>;
                })}</fieldset><label htmlFor="knowledge-context-toggle" className="agent-mode-toggle"><input id="knowledge-context-toggle" type="checkbox" checked={includeKnowledge} onChange={(event) => setIncludeKnowledge(event.target.checked)} disabled={chatLoading} />Knowledge-Kontext</label>{includeKnowledge && <small className="knowledge-sharing-note">{[...new Set([chatProvider, ...agentRoleIds.map(agentProviderFor)])].some((provider) => provider !== "ollama") ? `Relevante Auszüge gehen an ${[...new Set([chatProvider, ...agentRoleIds.map(agentProviderFor)])].filter((provider) => provider !== "ollama").map((provider) => chatProviderNames[provider]).join(", ")} API.` : "Relevante Auszüge bleiben lokal bei Ollama."}</small>}<label htmlFor="agent-rounds">RUNDEN</label><select id="agent-rounds" value={agentRounds} onChange={(event) => setAgentRounds(Number(event.target.value))} disabled={chatLoading}><option value={1}>1 Runde</option><option value={2} disabled={agentCount * 2 + 1 > maxAgentCalls}>2 Runden</option><option value={3} disabled={agentCount * 3 + 1 > maxAgentCalls}>3 Runden</option></select><label htmlFor="agent-call-limit">LIMIT</label><select id="agent-call-limit" value={maxAgentCalls} onChange={(event) => updateMaxAgentCalls(Number(event.target.value))} disabled={chatLoading}>{Array.from({ length: 11 }, (_, index) => index + 3).map((value) => <option key={value} value={value}>{value} Aufrufe</option>)}</select><small className="agent-call-count">{agentCount * agentRounds + 1}/{maxAgentCalls}</small></>}
              </div>
            </div>
            {modelsError && <p className="chat-error" role="alert">{modelsError}</p>}
            {!multiAgentMode && <div className="knowledge-actions">
              <label className="agent-mode-toggle">
                <input type="checkbox" checked={autoKnowledge} onChange={(event) => {
                  setAutoKnowledge(event.target.checked);
                  localStorage.setItem("unfeal-auto-knowledge", String(event.target.checked));
                  setAutoKnowledgeStatus("");
                }} disabled={chatLoading} />
                Automatisch in Knowledge speichern
              </label>
              <label className="agent-mode-toggle">
                <input type="checkbox" checked={includeKnowledge} onChange={(event) => setIncludeKnowledge(event.target.checked)} disabled={chatLoading} />
                Knowledge-Kontext
              </label>
              {autoKnowledge && <small>Nach jeweils fünf Gesprächsrunden aktualisiert das gewählte Modell eine Memory.{chatProvider !== "ollama" && ` Die Zusammenfassung läuft über die ${chatProviderNames[chatProvider]} API.`}</small>}
              {includeKnowledge && chatProvider !== "ollama" && <small>Passende Knowledge-Auszüge werden an die {chatProviderNames[chatProvider]} API gesendet.</small>}
            </div>}
            {!multiAgentMode && <section className="chat-workspace" aria-label="Arbeitsordner">
              <div className="knowledge-actions">
                <button type="button" disabled={chatLoading || workspaceLoading} onClick={chooseWorkspace}>{workspaceRoot ? "Ordner wechseln" : "Arbeitsordner wählen"}</button>
                {workspaceRoot && <>
                  <button type="button" disabled={chatLoading || workspaceLoading} onClick={chooseWorkspaceFiles}>{workspaceFiles.length ? "Dateiauswahl ändern" : "Dateien auswählen"}</button>
                  <button type="button" disabled={chatLoading || workspaceLoading} onClick={clearWorkspace}>Arbeitsordner trennen</button>
                </>}
              </div>
              {workspaceRoot && <small className="workspace-path" title={workspaceRoot}>{workspaceRoot}</small>}
              {workspaceFiles.length > 0 && <>
                <ul>{workspaceFiles.map((file) => <li key={file.name}>{file.name}</li>)}</ul>
                <small>{chatProvider === "ollama" ? "Dateiinhalte bleiben lokal bei Ollama." : `Dateiinhalte werden bei jeder Nachricht an ${chatProviderNames[chatProvider]} gesendet.`}</small>
              </>}
              {workspaceError && <p className="chat-error" role="alert">{workspaceError}</p>}
            </section>}
            {autoKnowledgeStatus && <small role="status">{autoKnowledgeStatus}</small>}
            {chatError && <p className="chat-error" role="alert">{chatError}</p>}
            {chatNotice && <p className="chat-success" role="status">{chatNotice}</p>}
            <div
              className="chat-messages"
              role="log"
              aria-live="polite"
              aria-label="Chatverlauf"
              ref={chatMessagesRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                shouldAutoScrollChatRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
              }}
            >
              {chatMessages.length === 0 && !chatLoading && <div className="chat-empty"><span>✧</span><strong>Womit kann ich dir helfen?</strong><small>Deine Unterhaltung bleibt in dieser Sitzung.</small></div>}
              {chatMessages.map((chatMessage, index) => (
                <article className={`chat-message ${chatMessage.role}`} key={`${index}-${chatMessage.role}`}>
                  <span>{chatMessage.role === "user" ? "DU" : chatProvider === "ollama" ? chatModel : `${chatProviderNames[chatProvider].toUpperCase()} · ${chatModel}`}</span>
                  <ChatMessageContent text={chatMessage.content} />
                </article>
              ))}
              {chatLoading && <div className="chat-thinking" role="status">{multiAgentMode ? <><span>{`${agentRoleIds.map((id) => agentRoles.find((agent) => agent.id === id)?.label).filter(Boolean).join(", ")} prüfen die Aufgabe in ${agentRounds} Runde${agentRounds === 1 ? "" : "n"}; der Manager fasst zusammen …`}</span>{chatProgress.length > 0 && <small className="chat-progress-lines">{chatProgress.slice(-4).map((status, index) => <span key={`${index}-${status}`}>{status}</span>)}</small>}</> : `${chatModel} antwortet …`}</div>}
            </div>
            {jarvisMode && <JarvisPanel
              busy={chatLoading}
              progress={chatProgress}
              reply={[...chatMessages].reverse().find((entry) => entry.role === "assistant")?.content ?? ""}
              onDictation={(text) => setMessage((current) => [current.trimEnd(), text].filter(Boolean).join(" ").slice(0, 20000))}
            />}
            <form className="chat-composer" onSubmit={sendChatMessage}>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
                placeholder="Schreibe eine Nachricht … (Enter zum Senden, Shift+Enter für neue Zeile)"
                maxLength={20000}
                disabled={chatLoading}
              />
              {chatLoading ? <button type="button" className="chat-stop" onClick={() => window.unfeal.providers.cancelChat()} aria-label="Antwort stoppen" title="Antwort stoppen">■</button> : <button type="submit" disabled={!message.trim() || !chatModel} aria-label="Nachricht senden">↑</button>}
            </form>
            <small className="chat-privacy-note">{multiAgentMode ? `MULTI-AGENT · ${agentCount} × ${agentRounds} + MANAGER = ${agentCount * agentRounds + 1}/${maxAgentCalls} MODELLAUFRUFE · ${[...new Set([chatProvider, ...agentRoleIds.map(agentProviderFor)])].map((provider) => provider === "ollama" ? "OLLAMA LOKAL" : `${chatProviderNames[provider].toUpperCase()} API`).join(" + ")} · ${includeKnowledge ? "KNOWLEDGE-AUSZÜGE WERDEN MITGESENDET" : "KNOWLEDGE AUS"} · CHAT LOKAL GESPEICHERT` : chatProvider === "ollama" ? "LOKAL ÜBER OLLAMA · CHATS BLEIBEN LOKAL GESPEICHERT" : `${chatProviderNames[chatProvider].toUpperCase()} API · CHATS BLEIBEN LOKAL GESPEICHERT`}</small>
          </div>
        );

      case "Projects":
        return (
          <div className="welcome">
            <div className="eyebrow">WORKSPACE / LOCAL STORAGE</div>
            <h1>Your <span>Projects</span></h1>
            <p>Erstelle und verwalte deine lokalen Projekte.</p>

            <form onSubmit={createProject} style={{ maxWidth: 600, margin: "28px auto" }}>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Projektname"
                required
                maxLength={100}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 12,
                  padding: 14,
                  borderRadius: 10,
                  background: "#151321",
                  color: "white",
                  border: "1px solid #393047"
                }}
              />

              <textarea
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder="Beschreibung (optional)"
                maxLength={2000}
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 90,
                  boxSizing: "border-box",
                  marginBottom: 12,
                  padding: 14,
                  borderRadius: 10,
                  background: "#151321",
                  color: "white",
                  border: "1px solid #393047"
                }}
              />

              <button type="submit">＋ Projekt erstellen</button>
              <button
                type="button"
                onClick={loadProjects}
                style={{ marginLeft: 10 }}
              >
                ↻ Aktualisieren
              </button>
            </form>

            {projectError && (
              <p role="alert" style={{ color: "#ff7373" }}>{projectError}</p>
            )}

            <h2 style={{ marginTop: 32 }}>Deine Projekte ({projects.length})</h2>

            {loadingProjects ? (
              <p>Projekte werden geladen …</p>
            ) : projects.length === 0 ? (
              <p>Noch keine Projekte. Erstelle dein erstes Projekt oben.</p>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 16,
                maxWidth: 900,
                margin: "24px auto",
                textAlign: "left"
              }}>
                {projects.map((project) => (
                  <article
                    key={project.id}
                    className="status-card"
                    style={{ padding: 20, minWidth: 0 }}
                  >
                    <h3>{project.name}</h3>
                    <p>{project.description || "Keine Beschreibung"}</p>
                    <small>
                      Erstellt: {new Date(project.createdAt).toLocaleDateString()}
                    </small>
                    <div style={{ marginTop: 16 }}>
                      <button onClick={() => setMessage(project.name)}>
                        Name in Chat übernehmen
                      </button>
                      <button
                        onClick={() => deleteProject(project.id)}
                        style={{ marginTop: 8 }}
                      >
                        Löschen
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        );

      case "Models":
        return (
          <div className="welcome">
            <div className="eyebrow">OLLAMA / LOCAL AI</div>
            <h1>Local <span>Models</span></h1>
            <p>Verwalte deine lokal installierten KI-Modelle.</p>

            <div style={{ maxWidth: 800, margin: "28px auto", textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h2>Installierte Modelle ({models.length})</h2>
                <button onClick={loadModels} disabled={loadingModels}>
                  {loadingModels ? "Lädt ..." : "↻ Aktualisieren"}
                </button>
              </div>

              {modelsError && (
                <p role="alert" style={{ color: "#ff7373" }}>{modelsError}</p>
              )}

              {loadingModels ? (
                <p>Modelle werden geladen ...</p>
              ) : models.length === 0 && !modelsError ? (
                <p>Noch keine Modelle installiert. Du kannst später Modelle über Ollama oder Hugging Face hinzufügen.</p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {models.map((model) => (
                    <article key={model.name} className="status-card" style={{ padding: 20 }}>
                      <h3>{model.name}</h3>
                      <p>Größe: {(model.size / 1024 / 1024 / 1024).toFixed(2)} GB</p>
                      <small>
                        Aktualisiert: {new Date(model.modified_at).toLocaleString()}
                      </small>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <section className="hf-catalog">
              <div className="eyebrow">HUGGING FACE HUB</div>
              <h2>GGUF-Modellsuche</h2>
              <p>Suche Modelle auf Hugging Face und prüfe verfügbare GGUF-Dateien. Dieser Schritt lädt noch keine Modelldateien herunter.</p>
              <form className="hf-search-form" onSubmit={searchHuggingFaceModels}>
                <input value={huggingFaceQuery} onChange={(event) => setHuggingFaceQuery(event.target.value)} placeholder="z. B. Qwen3 oder Llama" maxLength={100} aria-label="Hugging Face Modelle suchen" />
                <button type="submit" disabled={huggingFaceLoading || huggingFaceQuery.trim().length < 2}>{huggingFaceLoading ? "Suche …" : "Suchen"}</button>
              </form>
              {huggingFaceError && <p className="hf-error" role="alert">{huggingFaceError}</p>}
              {!huggingFaceLoading && huggingFaceQuery && huggingFaceModels.length === 0 && !huggingFaceError && <p className="hf-empty">Noch keine Suche ausgeführt oder keine GGUF-Modelle gefunden.</p>}
              <div className="hf-model-list">
                {huggingFaceModels.map((model) => (
                  <article className="hf-model-card" key={model.id}>
                    <div className="hf-model-heading"><div><h3>{model.id}</h3><small>{model.author || "Community Repository"}</small></div>{model.gated && <span className="hf-gated">ZUGANG BESCHRÄNKT</span>}</div>
                    <div className="hf-model-meta"><span>{model.downloads.toLocaleString()} Downloads</span><span>{model.likes.toLocaleString()} Likes</span>{model.lastModified && <span>Aktualisiert {new Date(model.lastModified).toLocaleDateString()}</span>}</div>
                    {model.tags.length > 0 && <div className="hf-tags">{model.tags.filter((tag) => tag.length < 36).slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>}
                    <div className="hf-model-actions"><button type="button" onClick={() => void loadHuggingFaceFiles(model.id)} disabled={huggingFaceFilesLoading && huggingFaceSelectedRepo === model.id}>{huggingFaceFilesLoading && huggingFaceSelectedRepo === model.id ? "Lade Dateien …" : "GGUF-Dateien prüfen"}</button><button type="button" className="hf-secondary-button" onClick={() => void window.unfeal.app.openExternal(`https://huggingface.co/${model.id}`)}>Repository öffnen</button></div>
                    {huggingFaceSelectedRepo === model.id && <div className="hf-file-list">
                      {huggingFaceFilesLoading && <p>GGUF-Dateien werden geladen …</p>}
                      {huggingFaceFilesError && <p className="hf-error" role="alert">{huggingFaceFilesError}</p>}
                      {!huggingFaceFilesLoading && !huggingFaceFilesError && huggingFaceFiles.length === 0 && <p>Keine GGUF-Dateien in diesem Repository gefunden.</p>}
                      {huggingFaceFiles.map((file) => <div className="hf-file-item" key={file.path}><code>{file.path}</code><span>{formatFileSize(file.size)}</span></div>)}
                    </div>}
                  </article>
                ))}
              </div>
            </section>
          </div>
        );

      case "Settings":
        return (
          <div className="settings-page">
            <div className="eyebrow">CONFIGURATION</div>
            <h1>System <span>Settings</span></h1>
            <p>Provider-Zugriff bleibt lokal verwaltet.</p>
            {providerSettingsError && <p className="chat-error" role="alert">{providerSettingsError}</p>}
            {providerSettingsNotice && <p className="chat-success" role="status">{providerSettingsNotice}</p>}
            <section className="settings-card system-panel-settings">
              <h2>Systemleiste</h2>
              <label>
                Ansicht
                <select value={systemPanel} onChange={(event) => {
                  const view = event.target.value as typeof systemPanel;
                  setSystemPanel(view);
                  localStorage.setItem("unfeal-system-panel", view);
                }}>
                  <option value="compact">Kompakt</option>
                  <option value="standard">Standard</option>
                  <option value="hidden">Ausgeblendet</option>
                </select>
              </label>
              <fieldset disabled={systemPanel === "hidden"}>
                <legend>Sichtbare Karten</legend>
                {([
                  ["engine", "KI-Anbieter"],
                  ["application", "Anwendung"],
                  ["environment", "Umgebung"]
                ] as const).map(([id, label]) => (
                  <label key={id}>
                    <input type="checkbox" checked={systemCards[id]} onChange={(event) => {
                      const checked = event.target.checked;
                      setSystemCards((cards) => ({ ...cards, [id]: checked }));
                      localStorage.setItem(`unfeal-system-card-${id}`, String(checked));
                    }} />
                    {label}
                  </label>
                ))}
              </fieldset>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><div><span className="settings-provider-icon">C</span><div><h2>Claude by Anthropic</h2><p>Cloud-Provider für Claude-Modelle</p></div></div><span className={`provider-status ${anthropicKeyStatus.configured ? "ready" : "missing"}`}>{anthropicKeyStatus.configured ? "EINGERICHTET" : "API-SCHLÜSSEL FEHLT"}</span></div>
              <form className="provider-key-form" onSubmit={saveAnthropicApiKey}>
                <label htmlFor="anthropic-api-key">Anthropic API-Schlüssel</label>
                <div><input id="anthropic-api-key" type="password" value={anthropicKeyInput} onChange={(event) => setAnthropicKeyInput(event.target.value)} placeholder={anthropicKeyStatus.configured ? "Neuen Schlüssel eingeben, um zu ersetzen" : "sk-ant-…"} autoComplete="off" spellCheck={false} maxLength={500} /><button type="submit" disabled={savingProviderKey || !anthropicKeyInput.trim()}>{savingProviderKey ? "Speichere …" : "Schlüssel speichern"}</button></div>
              </form>
              <p className="provider-key-privacy">Der Schlüssel wird im Electron-Hauptprozess mit safeStorage verschlüsselt. Er erscheint nicht in Chats oder im Repository und wird nicht an den Renderer zurückgegeben. {anthropicKeyStatus.encryptionAvailable ? "Verschlüsselung verfügbar." : "Verschlüsselung derzeit nicht verfügbar."}</p>
              {anthropicKeyStatus.configured && <button className="provider-key-remove" onClick={removeAnthropicApiKey}>Gespeicherten Schlüssel entfernen</button>}
              <small>Claude API-Nutzung kann ein separates Anthropic API-Guthaben erfordern.</small>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><div><span className="settings-provider-icon openai-icon">◎</span><div><h2>OpenAI API</h2><p>Cloud-Provider für OpenAI-Modelle</p></div></div><span className={`provider-status ${openaiKeyStatus.configured ? "ready" : "missing"}`}>{openaiKeyStatus.configured ? "EINGERICHTET" : "API-SCHLÜSSEL FEHLT"}</span></div>
              <form className="provider-key-form" onSubmit={saveOpenaiApiKey}>
                <label htmlFor="openai-api-key">OpenAI API-Schlüssel</label>
                <div><input id="openai-api-key" type="password" value={openaiKeyInput} onChange={(event) => setOpenaiKeyInput(event.target.value)} placeholder={openaiKeyStatus.configured ? "Neuen Schlüssel eingeben, um zu ersetzen" : "sk-…"} autoComplete="off" spellCheck={false} maxLength={500} /><button type="submit" disabled={savingProviderKey || !openaiKeyInput.trim()}>{savingProviderKey ? "Speichere …" : "Schlüssel speichern"}</button></div>
              </form>
              <p className="provider-key-privacy">Der Schlüssel wird wie der Claude-Schlüssel ausschließlich im Electron-Hauptprozess mit safeStorage verschlüsselt verwaltet. Er wird nicht an den Renderer zurückgegeben. {openaiKeyStatus.encryptionAvailable ? "Verschlüsselung verfügbar." : "Verschlüsselung derzeit nicht verfügbar."}</p>
              {openaiKeyStatus.configured && <button className="provider-key-remove" onClick={removeOpenaiApiKey}>Gespeicherten Schlüssel entfernen</button>}
              <small>ChatGPT Plus enthält kein OpenAI-API-Guthaben. API-Aufrufe werden über dein OpenAI-API-Konto abgerechnet.</small>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><div><span className="settings-provider-icon gemini-icon">✦</span><div><h2>Google Gemini</h2><p>Cloud-Provider für Gemini-Modelle</p></div></div><span className={`provider-status ${geminiKeyStatus.configured ? "ready" : "missing"}`}>{geminiKeyStatus.configured ? "EINGERICHTET" : "API-SCHLÜSSEL FEHLT"}</span></div>
              <form className="provider-key-form" onSubmit={saveGeminiApiKey}>
                <label htmlFor="gemini-api-key">Google AI API-Schlüssel</label>
                <div><input id="gemini-api-key" type="password" value={geminiKeyInput} onChange={(event) => setGeminiKeyInput(event.target.value)} placeholder={geminiKeyStatus.configured ? "Neuen Schlüssel eingeben, um zu ersetzen" : "API-Schlüssel aus Google AI Studio"} autoComplete="off" spellCheck={false} maxLength={500} /><button type="submit" disabled={savingProviderKey || !geminiKeyInput.trim()}>{savingProviderKey ? "Speichere …" : "Schlüssel speichern"}</button></div>
              </form>
              <p className="provider-key-privacy">Der Schlüssel wird ausschließlich im Electron-Hauptprozess mit safeStorage verschlüsselt. Gemini-Anfragen verwenden ihn im x-goog-api-key-Header; er wird nicht an den Renderer zurückgegeben. {geminiKeyStatus.encryptionAvailable ? "Verschlüsselung verfügbar." : "Verschlüsselung derzeit nicht verfügbar."}</p>
              {geminiKeyStatus.configured && <button className="provider-key-remove" onClick={removeGeminiApiKey}>Gespeicherten Schlüssel entfernen</button>}
              <button className="provider-key-link" onClick={() => void window.unfeal.app.openExternal("https://aistudio.google.com/app/apikey")}>Google AI Studio öffnen</button>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><div><span className="settings-provider-icon">✦</span><div><h2>OpenRouter</h2><p>Cloud-Provider für OpenRouter-Modelle</p></div></div><span className={`provider-status ${openrouterKeyStatus.configured ? "ready" : "missing"}`}>{openrouterKeyStatus.configured ? "EINGERICHTET" : "API-SCHLÜSSEL FEHLT"}</span></div>
              <form className="provider-key-form" onSubmit={saveOpenrouterApiKey}>
                <label htmlFor="openrouter-api-key">OpenRouter API-Schlüssel</label>
                <div><input id="openrouter-api-key" type="password" value={openrouterKeyInput} onChange={(event) => setOpenrouterKeyInput(event.target.value)} placeholder={openrouterKeyStatus.configured ? "Neuen Schlüssel eingeben, um zu ersetzen" : "API-Schlüssel von openrouter.ai"} autoComplete="off" spellCheck={false} maxLength={500} /><button type="submit" disabled={savingProviderKey || !openrouterKeyInput.trim()}>{savingProviderKey ? "Speichere …" : "Schlüssel speichern"}</button></div>
              </form>
              <p className="provider-key-privacy">Der Schlüssel wird ausschließlich im Electron-Hauptprozess mit safeStorage verschlüsselt. OpenRouter-Anfragen verwenden ihn im Authorization-Header; er wird nicht an den Renderer zurückgegeben. {openrouterKeyStatus.encryptionAvailable ? "Verschlüsselung verfügbar." : "Verschlüsselung derzeit nicht verfügbar."}</p>
              {openrouterKeyStatus.configured && <button className="provider-key-remove" onClick={removeOpenrouterApiKey}>Gespeicherten Schlüssel entfernen</button>}
              <button className="provider-key-link" onClick={() => void window.unfeal.app.openExternal("https://aistudio.google.com/app/apikey")}>Google AI Studio öffnen</button>
            </section>
          </div>
        );

      case "Knowledge":
        return (
          <div className="knowledge-page">
            <div className="eyebrow">LOCAL-FIRST / PRIVATE</div>
            <h1>UNFEAL <span>Knowledge</span></h1>
            <p>Lokale Erinnerungen und Markdown-Inhalte verwalten.</p>
            <form className="knowledge-search" onSubmit={searchKnowledge}>
              <input value={knowledgeSearchQuery} onChange={(event) => setKnowledgeSearchQuery(event.target.value)} placeholder="Memories und Dokumente durchsuchen" maxLength={300} />
              <button type="submit" disabled={searchingKnowledge}>{searchingKnowledge ? "Sucht …" : "⌕ Suchen"}</button>
            </form>
            {knowledgeSearchError && <p role="alert" className="knowledge-error">{knowledgeSearchError}</p>}
            {knowledgeVaultStatus && <p className="knowledge-vault-status" role="status">{knowledgeVaultStatus}</p>}
            {knowledgeSearchComplete && knowledgeSearchResults.length === 0 && <p className="knowledge-search-empty">Keine Treffer für diese Suche.</p>}
            {knowledgeSearchResults.length > 0 && (
              <div className="knowledge-search-results">
                <span className="knowledge-category">{knowledgeSearchResults.length} Suchtreffer</span>
                {knowledgeSearchResults.map((item) => (
                  <button className="knowledge-search-result" key={`${item.type}-${item.id}`} onClick={() => openSearchResult(item)}>
                    <span className="knowledge-category">{item.type === "memory" ? "Memory" : "Document"} · {item.category}</span>
                    <strong>{item.title}</strong>
                    <span>{item.content || "Kein Inhalt"}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="knowledge-tabs">
              <button className={knowledgeType === "memory" ? "selected" : ""} onClick={() => { resetKnowledgeForm(); setKnowledgeType("memory"); }}>Memories</button>
              <button className={knowledgeType === "document" ? "selected" : ""} onClick={() => { resetKnowledgeForm(); setKnowledgeType("document"); }}>Documents</button>
              <button className={knowledgeType === "relation" ? "selected" : ""} onClick={() => { resetKnowledgeForm(); setKnowledgeType("relation"); }}>Verbindungen</button>
              <button className={knowledgeType === "graph" ? "selected" : ""} onClick={() => { resetKnowledgeForm(); setKnowledgeType("graph"); }}>Graph</button>
              <button className={knowledgeType === "history" ? "selected" : ""} onClick={() => { resetKnowledgeForm(); setKnowledgeType("history"); }}>Verlauf</button>
              <button onClick={refreshKnowledge} disabled={loadingKnowledge}>↻ Aktualisieren</button>
              {knowledgeType === "document" && <button onClick={importMarkdownDocuments}>Markdown importieren</button>}
              <button onClick={exportKnowledgeBackup}>Backup exportieren</button>
              <button onClick={restoreKnowledgeBackup}>Backup zusammenführen</button>
            </div>
            {knowledgeType === "history" ? (
              <>
                <section className="knowledge-outbox">
                  <div className="knowledge-outbox-heading"><div><span className="knowledge-category">LOCAL-FIRST</span><h2>Ausstehende Synchronisation</h2></div><strong>{pendingSync.length}</strong></div>
                  <p>Änderungen werden lokal vorgemerkt und warten auf eine spätere Sync-Verbindung.</p>
                  {loadingKnowledge ? <p>Outbox wird geladen …</p> : pendingSync.length === 0 ? <p>Keine offenen Änderungen.</p> : pendingSync.map((entry) => (
                    <article className="knowledge-outbox-item" key={entry.id}>
                      <span>{entry.entity_type === "memory" ? "Memory" : entry.entity_type === "document" ? "Document" : "Verbindung"} · {entry.operation === "delete" ? "Löschen" : "Änderung"}</span>
                      <strong>{entry.title}</strong>
                      <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
                    </article>
                  ))}
                </section>
                <div className="knowledge-list">
                  <h2>Änderungsverlauf</h2>
                  {loadingKnowledge ? <p>Verlauf wird geladen …</p> : knowledgeHistory.length === 0 ? <p>Noch keine Änderungen vorhanden.</p> : knowledgeHistory.map((event) => (
                    <article className="knowledge-item knowledge-history-item" key={event.id}>
                      <div><span className="knowledge-category">{event.entity_type === "memory" ? "Memory" : event.entity_type === "document" ? "Document" : "Verbindung"}</span><h3>{event.title}</h3><small>{({ created: "Erstellt", created_from_markdown: "Aus Markdown importiert", updated: "Bearbeitet", updated_from_markdown: "Aus Markdown aktualisiert", deleted: "Gelöscht" } as Record<string, string>)[event.action] || event.action}</small></div>
                      <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
                    </article>
                  ))}
                </div>
              </>
            ) : knowledgeType === "graph" ? (
              <>
                {loadingKnowledge ? <p>Knowledge Graph wird geladen …</p> : <KnowledgeGraph
                  items={relationItems.map((item) => ({ ...item, graphType: item.category.startsWith("Memory ·") ? "memory" : "document" }))}
                  relations={relations}
                  onSelect={openGraphNode}
                  onSelectRelation={openGraphRelation}
                />}
                {knowledgeError && <p role="alert" className="knowledge-error">{knowledgeError}</p>}
              </>
            ) : knowledgeType === "relation" ? (
              <>
                <form className="knowledge-form relation-form" onSubmit={saveRelation}>
                  <label>Quelle
                    <div className="relation-select-row">
                      <select value={relationSourceType} onChange={(event) => { const type = event.target.value as KnowledgeEntityType; setRelationSourceType(type); setRelationSourceId(relationItems.find((item) => item.category.startsWith(type === "memory" ? "Memory ·" : "Document ·"))?.id || ""); }}>
                        <option value="memory">Memory</option><option value="document">Document</option>
                      </select>
                      <select value={relationSourceId} onChange={(event) => setRelationSourceId(event.target.value)} required>
                        {relationItems.filter((item) => item.category.startsWith(relationSourceType === "memory" ? "Memory ·" : "Document ·")).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                      </select>
                    </div>
                  </label>
                  <input value={relationLabel} onChange={(event) => setRelationLabel(event.target.value)} placeholder="Beziehung, z. B. gehört zu" maxLength={80} required />
                  <label>Ziel
                    <div className="relation-select-row">
                      <select value={relationTargetType} onChange={(event) => { const type = event.target.value as KnowledgeEntityType; setRelationTargetType(type); setRelationTargetId(relationItems.find((item) => item.category.startsWith(type === "memory" ? "Memory ·" : "Document ·"))?.id || ""); }}>
                        <option value="memory">Memory</option><option value="document">Document</option>
                      </select>
                      <select value={relationTargetId} onChange={(event) => setRelationTargetId(event.target.value)} required>
                        {relationItems.filter((item) => item.category.startsWith(relationTargetType === "memory" ? "Memory ·" : "Document ·")).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                      </select>
                    </div>
                  </label>
                  <div className="knowledge-actions"><button type="submit" disabled={!relationSourceId || !relationTargetId}>{editingRelationId ? "Verbindung speichern" : "＋ Verbindung erstellen"}</button>{editingRelationId && <button type="button" onClick={resetKnowledgeForm}>Abbrechen</button>}</div>
                </form>
                {knowledgeError && <p role="alert" className="knowledge-error">{knowledgeError}</p>}
                <div className="knowledge-list">
                  {loadingKnowledge ? <p>Knowledge wird geladen …</p> : relations.length === 0 ? <p>Noch keine Verbindungen vorhanden.</p> : relations.map((relation) => (
                    <article className="knowledge-item" key={relation.id}>
                      <div><span className="knowledge-category">{relation.relation_type}</span><h3>{relation.source_title} <span className="relation-arrow">→</span> {relation.target_title}</h3><small>{relation.source_type} → {relation.target_type}</small></div>
                      <div className="knowledge-item-actions"><button onClick={() => { setEditingRelationId(relation.id); setRelationSourceType(relation.source_type); setRelationSourceId(relation.source_id); setRelationTargetType(relation.target_type); setRelationTargetId(relation.target_id); setRelationLabel(relation.relation_type); }}>Bearbeiten</button><button onClick={() => deleteRelation(relation.id)}>Löschen</button></div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
            <>
            <form className="knowledge-form" onSubmit={saveKnowledge}>
              <input value={knowledgeTitle} onChange={(event) => setKnowledgeTitle(event.target.value)} placeholder="Titel" maxLength={200} required />
              <input value={knowledgeCategory} onChange={(event) => setKnowledgeCategory(event.target.value)} placeholder="Kategorie (optional)" maxLength={80} />
              <textarea value={knowledgeContent} onChange={(event) => setKnowledgeContent(event.target.value)} placeholder="Inhalt" maxLength={1000000} />
              <div className="knowledge-actions">
                <button type="submit">{editingKnowledgeId ? "Änderungen speichern" : "＋ Eintrag erstellen"}</button>
                {editingKnowledgeId && <button type="button" onClick={resetKnowledgeForm}>Abbrechen</button>}
              </div>
            </form>
            {knowledgeError && <p role="alert" className="knowledge-error">{knowledgeError}</p>}
            <div className="knowledge-list">
              {loadingKnowledge ? <p>Knowledge wird geladen …</p> : knowledgeItems.length === 0 ? <p>Noch keine Einträge vorhanden.</p> : knowledgeItems.map((item) => (
                <article className="knowledge-item" key={item.id}>
                  <div><span className="knowledge-category">{item.category}</span><h3>{item.title}</h3><p>{item.content || "Kein Inhalt"}</p><small>Aktualisiert: {new Date(item.updated_at).toLocaleString()}</small></div>
                  <div className="knowledge-item-actions">
                    {knowledgeType === "document" && <button onClick={() => exportMarkdownDocument(item)}>Markdown exportieren</button>}
                    <button onClick={() => { setEditingKnowledgeId(item.id); setKnowledgeTitle(item.title); setKnowledgeContent(item.content); setKnowledgeCategory(item.category); }}>Bearbeiten</button>
                    <button onClick={() => deleteKnowledge(item.id)}>Löschen</button>
                  </div>
                </article>
              ))}
            </div>
            </>
            )}
          </div>
        );

      default:
        return (
          <div className="desktop-overview">
            <DesktopClock />
            <section className="desktop-launcher" aria-labelledby="overview-heading">
              <h1 id="overview-heading">Was möchtest du tun?</h1>
              <div className="chat-box">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  aria-label="Nachricht vorbereiten"
                  placeholder="Nachricht an deine KI …"
                />
                <button type="button" onClick={() => setActivePage("AI Chat")} aria-label="Zum KI-Chat">↑</button>
              </div>
              <div className="quick-actions">
                <button type="button" onClick={() => setActivePage("AI Chat")}>✧ KI-Chat</button>
                <button type="button" onClick={() => setActivePage("Knowledge")}>◇ Knowledge</button>
                <button type="button" onClick={() => setActivePage("Projects")}>▤ Projekte</button>
              </div>
            </section>
          </div>
        );
    }
  }

  return (
    <main className={`app system-panel-${systemPanel}${activePage === "Overview" ? " app-overview" : ""}`}>
      <SakuraBackground />
      <aside className="sidebar">
        <div className="brand">UNFEAL<span> OS</span></div>

        <button disabled={chatLoading} onClick={() => {
          setMessage("");
          clearWorkspace();
          setChatId(null);
          setChatMessages([]);
          setChatError("");
          setActivePage("AI Chat");
        }}>
          ＋ New Chat
        </button>

        <p className="section-label">WORKSPACE</p>

        <nav aria-label="Workspace">
          {pages.map((page) => (
            <button
              type="button"
              key={page}
              className={`nav-item ${activePage === page ? "active" : ""}`}
              aria-current={activePage === page ? "page" : undefined}
              onClick={() => setActivePage(page)}
            >
              <span aria-hidden="true">{page === "Overview" ? "◈" :
                page === "AI Chat" ? "◉" :
                page === "Projects" ? "▤" :
                page === "Models" ? "⌘" :
                page === "Knowledge" ? "◇" : "⚙"}</span>
              {page}
            </button>
          ))}
        </nav>

        {chatSessions.length > 0 && <>
          <p className="section-label sidebar-chat-label">RECENT CHATS</p>
          <input
            className="sidebar-chat-search"
            type="search"
            value={chatSearch}
            onChange={(event) => setChatSearch(event.target.value)}
            placeholder="Chats durchsuchen …"
            aria-label="Gespeicherte Chats nach Titel, Modell oder Nachrichten durchsuchen"
          />
          <div className="sidebar-chats">
            {matchingChats.slice(0, chatSearch.trim() ? 40 : 8).map((chat) => (
              <div key={chat.id} className="sidebar-chat-row">
                <button className={`sidebar-chat ${chatId === chat.id ? "active" : ""}`} onClick={() => openChat(chat.id)} disabled={chatLoading} title={chat.title}>
                  <span>{chat.title}</span><small>{chat.model.replace(/^multi-config:.*$/, "Multi-Agent").replace(/^multi(?::|-[^:]+:)/, "Multi-Agent · ").replace(/^anthropic:/, "Claude · ").replace(/^openai:/, "OpenAI · ").replace(/^gemini:/, "Gemini · ").replace(/^openrouter:/, "OpenRouter · ").replace(/^ollama:/, "")}</small>
                </button>
                <div className="sidebar-chat-actions">
                  <button className="sidebar-chat-rename" onClick={() => renameChat(chat.id)} disabled={chatLoading} title="Chat umbenennen" aria-label={`Chat ${chat.title} umbenennen`}>✎</button>
                  <button className="sidebar-chat-delete" onClick={() => deleteChat(chat.id)} disabled={chatLoading} title="Chat löschen" aria-label={`Chat ${chat.title} löschen`}>×</button>
                </div>
              </div>
            ))}
            {matchingChats.length === 0 && <small className="sidebar-chat-empty">Keine passenden Chats</small>}
          </div>
        </>}

      </aside>

      <section className="main">
        <header>
          <span>UNFEAL / {activePage.toUpperCase()}</span>
          <span className="status">● LOCAL SYSTEM</span>
        </header>
        <UpdateNotice />
        {renderPage()}
      </section>

      {systemPanel !== "hidden" && <aside className="right-panel" aria-label="Systemstatus">
        <h3>SYSTEM STATUS</h3>
        {systemCards.engine && <div className="status-card">
          <span>KI-ANBIETER</span>
          <strong>{chatProviderNames[chatProvider]}</strong>
          <small>{chatProvider === "ollama" ? "LOKAL" : "CLOUD-API"}</small>
        </div>}
        {systemCards.application && <div className="status-card">
          <span>ANWENDUNG</span>
          <strong>UNFEAL OS</strong>
          <small>{import.meta.env.DEV ? "ENTWICKLUNGSMODUS" : "PRODUKTIONSVERSION"}</small>
        </div>}
        {systemCards.environment && <div className="status-card">
          <span>UMGEBUNG</span>
          <strong>WINDOWS</strong>
          <small>DESKTOP CLIENT</small>
        </div>}
      </aside>}
    </main>
  );
}



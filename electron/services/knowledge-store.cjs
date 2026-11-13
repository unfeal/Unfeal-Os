const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_TITLE = 200;
const MAX_CONTENT = 1000000;

function requiredText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string (max ${maxLength} characters).`);
  }
  return value.trim();
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label} must be a string (max ${maxLength} characters).`);
  }
  return value.trim();
}

function createKnowledgeStore(userDataPath) {
  const directory = path.join(userDataPath, "knowledge", "database");
  const vaultRoot = path.join(userDataPath, "knowledge", "vault");
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "notes"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "_deleted"), { recursive: true });
  const db = new Database(path.join(directory, "knowledge.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const migrations = [
    `CREATE TABLE memories (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general', source TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX memories_updated_at_idx ON memories(updated_at);`,
    `CREATE TABLE documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      path TEXT, category TEXT NOT NULL DEFAULT 'notes',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX documents_updated_at_idx ON documents(updated_at);
    CREATE TABLE relations (
      id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      target_type TEXT NOT NULL, target_id TEXT NOT NULL, relation_type TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(source_type, source_id, target_type, target_id, relation_type)
    );
    CREATE INDEX relations_source_idx ON relations(source_type, source_id);
    CREATE INDEX relations_target_idx ON relations(target_type, target_id);
    CREATE TABLE memory_events (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX memory_events_entity_idx ON memory_events(entity_type, entity_id, created_at);
    CREATE TABLE sync_outbox (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      operation TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, synced_at TEXT
    );
    CREATE INDEX sync_outbox_pending_idx ON sync_outbox(synced_at, created_at);`,
    `CREATE VIRTUAL TABLE memories_fts USING fts5(
      id UNINDEXED, title, content, category, tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE documents_fts USING fts5(
      id UNINDEXED, title, content, category, tokenize = 'unicode61 remove_diacritics 2'
    );
    INSERT INTO memories_fts (id, title, content, category)
      SELECT id, title, content, category FROM memories WHERE deleted_at IS NULL;
    INSERT INTO documents_fts (id, title, content, category)
      SELECT id, title, content, category FROM documents WHERE deleted_at IS NULL;
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories WHEN new.deleted_at IS NULL BEGIN
      INSERT INTO memories_fts (id, title, content, category) VALUES (new.id, new.title, new.content, new.category);
    END;
    CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
      DELETE FROM memories_fts WHERE id = old.id;
      INSERT INTO memories_fts (id, title, content, category)
        SELECT new.id, new.title, new.content, new.category WHERE new.deleted_at IS NULL;
    END;
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE id = old.id;
    END;
    CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents WHEN new.deleted_at IS NULL BEGIN
      INSERT INTO documents_fts (id, title, content, category) VALUES (new.id, new.title, new.content, new.category);
    END;
    CREATE TRIGGER documents_fts_update AFTER UPDATE ON documents BEGIN
      DELETE FROM documents_fts WHERE id = old.id;
      INSERT INTO documents_fts (id, title, content, category)
        SELECT new.id, new.title, new.content, new.category WHERE new.deleted_at IS NULL;
    END;
    CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN
      DELETE FROM documents_fts WHERE id = old.id;
    END;`,
    `CREATE INDEX documents_path_idx ON documents(path);`,
    `ALTER TABLE documents ADD COLUMN vault_hash TEXT;`,
    `CREATE TABLE chats (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX chats_updated_at_idx ON chats(updated_at);
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')), content TEXT NOT NULL,
      created_at TEXT NOT NULL, FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      UNIQUE(chat_id, sequence)
    );
    CREATE INDEX chat_messages_chat_idx ON chat_messages(chat_id, sequence);`
  ];

  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const currentVersion = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
  if (currentVersion > migrations.length) throw new Error("Knowledge database version is newer than this application.");
  for (let index = currentVersion; index < migrations.length; index += 1) {
    db.transaction(() => {
      db.exec(migrations[index]);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(index + 1, new Date().toISOString());
    })();
  }

  function documentRelativePath(id, deleted = false) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
      throw new Error("Invalid document id for vault path.");
    }
    return `${deleted ? "_deleted" : "notes"}/${id}.md`;
  }

  function resolveVaultPath(relativePath) {
    if (typeof relativePath !== "string") {
      throw new Error("Invalid Markdown vault path.");
    }
    const parts = relativePath.split("/");
    if (parts.length !== 2 || !["notes", "_deleted"].includes(parts[0]) ||
        !parts[1] || parts[1] === "." || parts[1] === ".." ||
        parts[1].includes("\\") || parts[1].includes(":") ||
        parts[1].length > 255 || !/\.md$/i.test(parts[1])) {
      throw new Error("Invalid Markdown vault path.");
    }
    const absolutePath = path.resolve(vaultRoot, ...relativePath.split("/"));
    const relative = path.relative(vaultRoot, absolutePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Markdown path is outside the local vault.");
    }
    const rootStat = fs.lstatSync(vaultRoot);
    const sectionPath = path.join(vaultRoot, parts[0]);
    const sectionStat = fs.lstatSync(sectionPath);
    if (rootStat.isSymbolicLink() || sectionStat.isSymbolicLink() || !sectionStat.isDirectory()) {
      throw new Error("Markdown vault folders cannot be symbolic links.");
    }
    try {
      if (fs.lstatSync(absolutePath).isSymbolicLink()) {
        throw new Error("Markdown vault files cannot be symbolic links.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return absolutePath;
  }

  function renderMarkdown(row) {
    return [
      "---",
      `id: ${JSON.stringify(row.id)}`,
      `title: ${JSON.stringify(row.title)}`,
      `category: ${JSON.stringify(row.category)}`,
      `created_at: ${JSON.stringify(row.created_at)}`,
      `updated_at: ${JSON.stringify(row.updated_at)}`,
      "---",
      "",
      row.content || "",
      ""
    ].join("\n");
  }

  function hashText(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
  }

  function markdownHash(row) {
    return hashText(renderMarkdown(row));
  }

  function parseMarkdownFile(value, expectedId) {
    const normalized = value.replace(/\r\n/g, "\n");
    const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(normalized);
    if (!match) return null;
    const metadata = {};
    for (const line of match[1].split("\n")) {
      const separator = line.indexOf(":");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      if (!["id", "title", "category", "created_at", "updated_at"].includes(key)) continue;
      try {
        metadata[key] = JSON.parse(line.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
    if (typeof metadata.id !== "string" || (expectedId && metadata.id !== expectedId) ||
        !/^[a-f0-9-]{36}$/i.test(metadata.id) || typeof metadata.title !== "string" ||
        typeof metadata.category !== "string") return null;
    let content = match[2];
    if (content.endsWith("\n")) content = content.slice(0, -1);
    if (content.length > MAX_CONTENT) return null;
    try {
      return {
        id: metadata.id,
        created_at: typeof metadata.created_at === "string" && !Number.isNaN(Date.parse(metadata.created_at))
          ? metadata.created_at
          : null,
        title: requiredText(metadata.title, "Title", MAX_TITLE),
        category: optionalText(metadata.category, "Category", 80) || "notes",
        content
      };
    } catch {
      return null;
    }
  }

  function writeMarkdownFile(row, relativePath) {
    const target = resolveVaultPath(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const markdown = renderMarkdown(row);
    try {
      fs.writeFileSync(temporary, markdown, "utf8");
      fs.renameSync(temporary, target);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
    return hashText(markdown);
  }

  function writeVaultText(relativePath, value) {
    const target = resolveVaultPath(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, value, "utf8");
      fs.renameSync(temporary, target);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
  }

  function moveMarkdownFile(row, fromRelativePath, toRelativePath) {
    const from = resolveVaultPath(fromRelativePath);
    const to = resolveVaultPath(toRelativePath);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(from)) fs.renameSync(from, to);
    else writeMarkdownFile(row, toRelativePath);
  }

  function tryRestoreMarkdown(row, relativePath) {
    try {
      writeMarkdownFile(row, relativePath);
    } catch (error) {
      console.error("Could not restore the Markdown vault file after a database error:", error);
    }
  }

  for (const document of db.prepare("SELECT * FROM documents WHERE path IS NULL").all()) {
    const relativePath = documentRelativePath(document.id, Boolean(document.deleted_at));
    writeMarkdownFile(document, relativePath);
    db.prepare("UPDATE documents SET path = ? WHERE id = ?").run(relativePath, document.id);
  }

  const now = () => new Date().toISOString();
  const addEvent = db.prepare("INSERT INTO memory_events (id, entity_type, entity_id, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const addOutbox = db.prepare("INSERT INTO sync_outbox (id, entity_type, entity_id, operation, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const tables = { memory: "memories", document: "documents" };

  function updateVaultState(id, relativePath, vaultHash) {
    db.prepare("UPDATE documents SET path = ?, vault_hash = ? WHERE id = ?").run(relativePath, vaultHash, id);
  }

  function syncMarkdownVault() {
    const documents = db.prepare("SELECT * FROM documents ORDER BY id").all();
    const summary = { checked: documents.length, imported: 0, restored: 0, conflicts: 0 };
    for (const document of documents) {
      const relativePath = document.path || documentRelativePath(document.id, Boolean(document.deleted_at));
      let absolutePath;
      try {
        absolutePath = resolveVaultPath(relativePath);
      } catch (error) {
        console.error(`Keeping document ${document.id}; its stored Markdown path is invalid.`, error);
        summary.conflicts += 1;
        continue;
      }
      if (!fs.existsSync(absolutePath)) {
        const restored = { ...document, path: relativePath };
        const vaultHash = writeMarkdownFile(restored, relativePath);
        updateVaultState(document.id, relativePath, vaultHash);
        summary.restored += 1;
        continue;
      }

      const fileContent = fs.readFileSync(absolutePath, "utf8");
      const fileHash = hashText(fileContent);
      const databaseContent = renderMarkdown(document);
      if (document.vault_hash && fileHash === document.vault_hash) {
        if (fileContent !== databaseContent || document.path !== relativePath) {
          const current = { ...document, path: relativePath };
          const vaultHash = writeMarkdownFile(current, relativePath);
          updateVaultState(document.id, relativePath, vaultHash);
        }
        continue;
      }

      if (!document.vault_hash && fileContent === databaseContent) {
        updateVaultState(document.id, relativePath, fileHash);
        continue;
      }

      const parsed = parseMarkdownFile(fileContent, document.id);
      if (!parsed) {
        console.error(`Keeping the database copy of document ${document.id}; its Markdown file has invalid front matter.`);
        summary.conflicts += 1;
        continue;
      }

      const hasContentChanges = parsed.title !== document.title ||
        parsed.category !== document.category || parsed.content !== document.content;
      if (!hasContentChanges) {
        const normalized = { ...document, path: relativePath };
        const vaultHash = writeMarkdownFile(normalized, relativePath);
        updateVaultState(document.id, relativePath, vaultHash);
        continue;
      }

      const timestamp = now();
      const updated = {
        ...document,
        title: parsed.title,
        category: parsed.category,
        content: parsed.content,
        path: relativePath,
        updated_at: timestamp
      };
      updated.vault_hash = markdownHash(updated);
      db.transaction(() => {
        db.prepare(`
          UPDATE documents SET title = ?, content = ?, category = ?, updated_at = ?, path = ?, vault_hash = ?
          WHERE id = ?
        `).run(updated.title, updated.content, updated.category, updated.updated_at, updated.path, updated.vault_hash, updated.id);
        addEvent.run(crypto.randomUUID(), "document", updated.id, "updated_from_markdown", JSON.stringify(updated), timestamp);
        addOutbox.run(crypto.randomUUID(), "document", updated.id, "upsert", JSON.stringify(updated), timestamp);
        writeMarkdownFile(updated, relativePath);
      })();
      summary.imported += 1;
    }

    const knownPaths = new Set(
      db.prepare("SELECT path FROM documents WHERE path IS NOT NULL").all()
        .map((row) => row.path.replace(/\\/g, "/"))
    );
    const notesDirectory = path.join(vaultRoot, "notes");
    for (const entry of fs.readdirSync(notesDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const relativePath = `notes/${entry.name}`;
      if (knownPaths.has(relativePath)) continue;
      summary.checked += 1;
      const absolutePath = resolveVaultPath(relativePath);
      const rawFile = fs.readFileSync(absolutePath, "utf8");
      if (rawFile.length > MAX_CONTENT + 10000) {
        summary.conflicts += 1;
        continue;
      }
      const parsed = parseMarkdownFile(rawFile, null);
      const id = parsed?.id || crypto.randomUUID();
      if (db.prepare("SELECT 1 FROM documents WHERE id = ?").get(id)) {
        summary.conflicts += 1;
        continue;
      }
      const titleFromFilename = path.basename(entry.name, path.extname(entry.name))
        .replace(/[-_]+/g, " ").slice(0, MAX_TITLE).trim();
      const createdAt = parsed?.created_at || now();
      const row = {
        id,
        title: parsed?.title || titleFromFilename || "Imported note",
        content: parsed?.content ?? rawFile.replace(/\r\n/g, "\n"),
        category: parsed?.category || "notes",
        path: relativePath,
        created_at: createdAt,
        updated_at: now()
      };
      if (row.content.length > MAX_CONTENT) {
        summary.conflicts += 1;
        continue;
      }
      row.vault_hash = markdownHash(row);
      try {
        db.transaction(() => {
          writeMarkdownFile(row, relativePath);
          const columns = Object.keys(row);
          db.prepare(`INSERT INTO documents (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(row));
          addEvent.run(crypto.randomUUID(), "document", id, "created_from_markdown", JSON.stringify(row), row.updated_at);
          addOutbox.run(crypto.randomUUID(), "document", id, "upsert", JSON.stringify(row), row.updated_at);
        })();
        knownPaths.add(relativePath);
        summary.imported += 1;
      } catch (error) {
        try {
          writeVaultText(relativePath, rawFile);
        } catch (restoreError) {
          console.error(`Could not restore imported Markdown file ${relativePath}.`, restoreError);
        }
        console.error(`Could not import Markdown file ${relativePath}.`, error);
        summary.conflicts += 1;
      }
    }
    return summary;
  }

  syncMarkdownVault();

  function list(type) {
    const table = tables[type];
    if (!table) throw new Error("Invalid knowledge entity type.");
    return db.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`).all();
  }

  function create(type, input) {
    const table = tables[type];
    if (!table || !input || typeof input !== "object") throw new Error("Invalid knowledge item.");
    const title = requiredText(input.title, "Title", MAX_TITLE);
    const content = optionalText(input.content, "Content", MAX_CONTENT);
    const category = optionalText(input.category, "Category", 80) || (type === "memory" ? "general" : "notes");
    const source = type === "memory" ? optionalText(input.source, "Source", 500) : null;
    const id = crypto.randomUUID();
    const timestamp = now();
    const row = type === "memory"
      ? { id, title, content, category, source, created_at: timestamp, updated_at: timestamp }
      : { id, title, content, category, path: documentRelativePath(id), created_at: timestamp, updated_at: timestamp };
    if (type === "document") row.vault_hash = markdownHash(row);
    try {
      db.transaction(() => {
        if (type === "document") writeMarkdownFile(row, row.path);
        const columns = Object.keys(row);
        db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(row));
        addEvent.run(crypto.randomUUID(), type, id, "created", JSON.stringify(row), timestamp);
        addOutbox.run(crypto.randomUUID(), type, id, "upsert", JSON.stringify(row), timestamp);
      })();
    } catch (error) {
      if (type === "document") {
        const file = resolveVaultPath(row.path);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      throw error;
    }
    return row;
  }

  function update(type, id, input) {
    const table = tables[type];
    if (!table || typeof id !== "string" || !id || !input || typeof input !== "object") throw new Error("Invalid knowledge item.");
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!existing) throw new Error("Knowledge item not found.");
    const row = {
      title: input.title === undefined ? existing.title : requiredText(input.title, "Title", MAX_TITLE),
      content: input.content === undefined ? existing.content : optionalText(input.content, "Content", MAX_CONTENT),
      category: input.category === undefined ? existing.category : (optionalText(input.category, "Category", 80) || "general"),
      updated_at: now()
    };
    if (type === "memory") row.source = input.source === undefined ? existing.source : optionalText(input.source, "Source", 500);
    else {
      row.path = existing.path || documentRelativePath(id);
      row.vault_hash = markdownHash({ ...existing, ...row });
    }
    const updated = { ...existing, ...row };
    try {
      db.transaction(() => {
        if (type === "document") writeMarkdownFile(updated, row.path);
        const assignments = Object.keys(row).map((key) => `${key} = ?`).join(", ");
        db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...Object.values(row), id);
        addEvent.run(crypto.randomUUID(), type, id, "updated", JSON.stringify(updated), row.updated_at);
        addOutbox.run(crypto.randomUUID(), type, id, "upsert", JSON.stringify(updated), row.updated_at);
      })();
    } catch (error) {
      if (type === "document") tryRestoreMarkdown(existing, existing.path || documentRelativePath(id));
      throw error;
    }
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  }

  function remove(type, id) {
    const table = tables[type];
    if (!table || typeof id !== "string" || !id) throw new Error("Invalid knowledge item id.");
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!existing) return false;
    const timestamp = now();
    const relatedRelations = db.prepare(`
      SELECT * FROM relations
      WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
    `).all(type, id, type, id);
    const previousPath = type === "document" ? existing.path || documentRelativePath(id) : null;
    const deletedPath = type === "document" ? documentRelativePath(id, true) : null;
    const deleted = {
      ...existing,
      ...(type === "document" ? { path: deletedPath } : {}),
      deleted_at: timestamp,
      updated_at: timestamp
    };
    if (type === "document") deleted.vault_hash = markdownHash(deleted);
    try {
      db.transaction(() => {
        if (type === "document") moveMarkdownFile(existing, previousPath, deletedPath);
        if (type === "document") writeMarkdownFile(deleted, deletedPath);
        if (type === "document") {
          db.prepare("UPDATE documents SET deleted_at = ?, updated_at = ?, path = ?, vault_hash = ? WHERE id = ?").run(timestamp, timestamp, deletedPath, deleted.vault_hash, id);
        } else {
          db.prepare("UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, id);
        }
        for (const relation of relatedRelations) {
          db.prepare("DELETE FROM relations WHERE id = ?").run(relation.id);
          recordRelationChange("deleted", relation, timestamp);
        }
        addEvent.run(crypto.randomUUID(), type, id, "deleted", JSON.stringify(deleted), timestamp);
        addOutbox.run(crypto.randomUUID(), type, id, "delete", JSON.stringify(deleted), timestamp);
      })();
    } catch (error) {
      if (type === "document") {
        try {
          const from = resolveVaultPath(deletedPath);
          const to = resolveVaultPath(previousPath);
          if (fs.existsSync(from)) fs.renameSync(from, to);
        } catch (restoreError) {
          console.error("Could not restore the Markdown vault file after a database error:", restoreError);
        }
      }
      throw error;
    }
    return true;
  }

  function validateRelation(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Invalid relation.");
    }
    const entityTypes = ["memory", "document"];
    const sourceType = input.sourceType;
    const targetType = input.targetType;
    if (!entityTypes.includes(sourceType) || !entityTypes.includes(targetType)) {
      throw new Error("Relations can only connect memories and documents.");
    }
    const sourceId = requiredText(input.sourceId, "Source id", 100);
    const targetId = requiredText(input.targetId, "Target id", 100);
    if (sourceType === targetType && sourceId === targetId) {
      throw new Error("An item cannot be related to itself.");
    }
    const sourceTable = tables[sourceType];
    const targetTable = tables[targetType];
    if (!db.prepare(`SELECT 1 FROM ${sourceTable} WHERE id = ? AND deleted_at IS NULL`).get(sourceId)) {
      throw new Error("Relation source was not found.");
    }
    if (!db.prepare(`SELECT 1 FROM ${targetTable} WHERE id = ? AND deleted_at IS NULL`).get(targetId)) {
      throw new Error("Relation target was not found.");
    }
    return {
      source_type: sourceType,
      source_id: sourceId,
      target_type: targetType,
      target_id: targetId,
      relation_type: requiredText(input.relationType, "Relation type", 80)
    };
  }

  function listRelations() {
    return db.prepare(`
      SELECT relations.*,
        CASE source_type
          WHEN 'memory' THEN (SELECT title FROM memories WHERE id = source_id)
          WHEN 'document' THEN (SELECT title FROM documents WHERE id = source_id)
        END AS source_title,
        CASE target_type
          WHEN 'memory' THEN (SELECT title FROM memories WHERE id = target_id)
          WHEN 'document' THEN (SELECT title FROM documents WHERE id = target_id)
        END AS target_title
      FROM relations
      ORDER BY created_at DESC LIMIT 500
    `).all();
  }

  function recordRelationChange(action, relation, timestamp) {
    addEvent.run(crypto.randomUUID(), "relation", relation.id, action, JSON.stringify(relation), timestamp);
    addOutbox.run(crypto.randomUUID(), "relation", relation.id, action === "deleted" ? "delete" : "upsert", JSON.stringify(relation), timestamp);
  }

  function createRelation(input) {
    const values = validateRelation(input);
    const duplicate = db.prepare(`
      SELECT 1 FROM relations WHERE source_type = ? AND source_id = ?
        AND target_type = ? AND target_id = ? AND relation_type = ?
    `).get(values.source_type, values.source_id, values.target_type, values.target_id, values.relation_type);
    if (duplicate) throw new Error("This relation already exists.");

    const relation = { id: crypto.randomUUID(), ...values, created_at: now() };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO relations (id, source_type, source_id, target_type, target_id, relation_type, created_at)
        VALUES (@id, @source_type, @source_id, @target_type, @target_id, @relation_type, @created_at)
      `).run(relation);
      recordRelationChange("created", relation, relation.created_at);
    })();
    return relation;
  }

  function updateRelation(id, input) {
    if (typeof id !== "string" || !id) throw new Error("Invalid relation id.");
    const existing = db.prepare("SELECT * FROM relations WHERE id = ?").get(id);
    if (!existing) throw new Error("Relation not found.");
    const values = validateRelation(input);
    const duplicate = db.prepare(`
      SELECT 1 FROM relations WHERE id != ? AND source_type = ? AND source_id = ?
        AND target_type = ? AND target_id = ? AND relation_type = ?
    `).get(id, values.source_type, values.source_id, values.target_type, values.target_id, values.relation_type);
    if (duplicate) throw new Error("This relation already exists.");

    const relation = { ...existing, ...values };
    const timestamp = now();
    db.transaction(() => {
      db.prepare(`
        UPDATE relations SET source_type = @source_type, source_id = @source_id,
          target_type = @target_type, target_id = @target_id, relation_type = @relation_type
        WHERE id = @id
      `).run(relation);
      recordRelationChange("updated", relation, timestamp);
    })();
    return relation;
  }

  function deleteRelation(id) {
    if (typeof id !== "string" || !id) throw new Error("Invalid relation id.");
    const relation = db.prepare("SELECT * FROM relations WHERE id = ?").get(id);
    if (!relation) return false;
    const timestamp = now();
    db.transaction(() => {
      db.prepare("DELETE FROM relations WHERE id = ?").run(id);
      recordRelationChange("deleted", relation, timestamp);
    })();
    return true;
  }

  function search(query, matchAny = false) {
    const cleanQuery = optionalText(query, "Search query", 300);
    const tokens = [...new Set(cleanQuery.match(/[\p{L}\p{N}_]+/gu) || [])].slice(0, 8);
    if (tokens.length === 0) return [];
    const expression = tokens.map((token) => `"${token}"*`).join(matchAny ? " OR " : " AND ");
    const memories = db.prepare(`
      SELECT memories.id, memories.title, memories.content, memories.category,
        memories.updated_at, bm25(memories_fts) AS score
      FROM memories_fts JOIN memories ON memories.id = memories_fts.id
      WHERE memories_fts MATCH ? AND memories.deleted_at IS NULL
      ORDER BY score LIMIT 50
    `).all(expression).map((item) => ({ ...item, type: "memory" }));
    const documents = db.prepare(`
      SELECT documents.id, documents.title, documents.content, documents.category,
        documents.updated_at, bm25(documents_fts) AS score
      FROM documents_fts JOIN documents ON documents.id = documents_fts.id
      WHERE documents_fts MATCH ? AND documents.deleted_at IS NULL
      ORDER BY score LIMIT 50
    `).all(expression).map((item) => ({ ...item, type: "document" }));
    return [...memories, ...documents]
      .sort((left, right) => left.score - right.score || right.updated_at.localeCompare(left.updated_at))
      .slice(0, 100);
  }

  function listChats(limit = 40) {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 40;
    return db.prepare(`
      SELECT chats.*, (SELECT COUNT(*) FROM chat_messages WHERE chat_id = chats.id) AS message_count
      FROM chats ORDER BY updated_at DESC, id DESC LIMIT ?
    `).all(safeLimit);
  }

  function searchChats(query, limit = 40) {
    if (typeof query !== "string" || query.length > 120) throw new Error("Invalid chat search query.");
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 40;
    const cleanQuery = query.trim();
    if (!cleanQuery) return listChats(safeLimit);
    const pattern = `%${cleanQuery.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    return db.prepare(`
      SELECT chats.*, (SELECT COUNT(*) FROM chat_messages WHERE chat_id = chats.id) AS message_count
      FROM chats
      WHERE title LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR model LIKE ? ESCAPE '\\' COLLATE NOCASE
         OR EXISTS (
           SELECT 1 FROM chat_messages
           WHERE chat_messages.chat_id = chats.id AND chat_messages.content LIKE ? ESCAPE '\\' COLLATE NOCASE
         )
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `).all(pattern, pattern, pattern, safeLimit);
  }

  function getChat(id) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid chat id.");
    const chat = db.prepare("SELECT chats.*, (SELECT COUNT(*) FROM chat_messages WHERE chat_id = chats.id) AS message_count FROM chats WHERE id = ?").get(id);
    if (!chat) return null;
    const messages = db.prepare(`
      SELECT id, role, content, created_at FROM chat_messages
      WHERE chat_id = ? ORDER BY sequence DESC LIMIT 200
    `).all(id).reverse();
    return { ...chat, messages };
  }

  function deleteChat(id) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid chat id.");
    return db.prepare("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
  }

  function renameChat(id, title) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid chat id.");
    const cleanTitle = requiredText(title, "Chat title", 80);
    const result = db.prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?").run(cleanTitle, now(), id);
    if (result.changes === 0) throw new Error("Chat not found.");
    return db.prepare("SELECT id, title, model, created_at, updated_at FROM chats WHERE id = ?").get(id);
  }

  function saveChatTurn(input) {
    if (!input || typeof input !== "object" || typeof input.model !== "string" || !input.model.trim() || input.model.length > 2000 ||
        !Array.isArray(input.messages) || input.messages.length !== 2 ||
        input.messages[0]?.role !== "user" || input.messages[1]?.role !== "assistant" ||
        input.messages.some((message) => !message || typeof message.content !== "string" || !message.content.trim() || message.content.length > 20000)) {
      throw new Error("Invalid chat turn.");
    }
    const timestamp = now();
    let chatId = input.id;
    if (chatId !== undefined && (typeof chatId !== "string" || !/^[a-f0-9-]{36}$/i.test(chatId))) throw new Error("Invalid chat id.");
    if (chatId && !db.prepare("SELECT 1 FROM chats WHERE id = ?").get(chatId)) throw new Error("Chat not found.");
    const isNew = !chatId;
    if (isNew) chatId = crypto.randomUUID();
    const userTitle = input.messages[0].content.trim().replace(/\s+/g, " ").slice(0, 80) || "Neuer Chat";
    db.transaction(() => {
      if (isNew) db.prepare("INSERT INTO chats (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(chatId, userTitle, input.model.trim(), timestamp, timestamp);
      else db.prepare("UPDATE chats SET model = ?, updated_at = ? WHERE id = ?").run(input.model.trim(), timestamp, chatId);
      let sequence = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM chat_messages WHERE chat_id = ?").get(chatId).value;
      for (const message of input.messages) {
        sequence += 1;
        db.prepare("INSERT INTO chat_messages (id, chat_id, sequence, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), chatId, sequence, message.role, message.content, timestamp);
      }
    })();
    return db.prepare("SELECT id, title, model, created_at, updated_at FROM chats WHERE id = ?").get(chatId);
  }

  function listHistory(limit = 100) {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 100;
    return db.prepare(`
      SELECT id, entity_type, entity_id, action, payload, created_at
      FROM memory_events
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit).map((event) => {
      let payload = {};
      try {
        payload = JSON.parse(event.payload || "{}");
      } catch {
        payload = {};
      }
      return {
        id: event.id,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        action: event.action,
        title: typeof payload.title === "string" ? payload.title : "Eintrag",
        created_at: event.created_at
      };
    });
  }

  function listPendingSync(limit = 100) {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 100;
    return db.prepare(`
      SELECT id, entity_type, entity_id, operation, payload, created_at
      FROM sync_outbox
      WHERE synced_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit).map((entry) => {
      let payload = {};
      try {
        payload = JSON.parse(entry.payload || "{}");
      } catch {
        payload = {};
      }
      return {
        id: entry.id,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        operation: entry.operation,
        title: typeof payload.title === "string" ? payload.title : "Eintrag",
        created_at: entry.created_at
      };
    });
  }

  async function exportBackup(parentDirectory) {
    if (typeof parentDirectory !== "string" || !path.isAbsolute(parentDirectory)) {
      throw new Error("A valid backup destination is required.");
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `UNFEAL-Knowledge-Backup-${timestamp}`;
    let backupDirectory = path.join(parentDirectory, baseName);
    let suffix = 1;
    while (fs.existsSync(backupDirectory)) {
      backupDirectory = path.join(parentDirectory, `${baseName}-${suffix}`);
      suffix += 1;
    }
    fs.mkdirSync(backupDirectory, { recursive: false });
    try {
      await db.backup(path.join(backupDirectory, "knowledge.sqlite"));
      fs.cpSync(vaultRoot, path.join(backupDirectory, "vault"), { recursive: true, errorOnExist: true });
      fs.writeFileSync(path.join(backupDirectory, "manifest.json"), JSON.stringify({
        application: "UNFEAL OS",
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        schemaVersion: migrations.length,
        contents: ["knowledge.sqlite", "vault/"]
      }, null, 2), "utf8");
      return backupDirectory;
    } catch (error) {
      fs.rmSync(backupDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  function openBackupDatabase(backupDirectory) {
    if (typeof backupDirectory !== "string" || !path.isAbsolute(backupDirectory)) {
      throw new Error("Invalid backup folder.");
    }
    const manifestPath = path.join(backupDirectory, "manifest.json");
    const databasePath = path.join(backupDirectory, "knowledge.sqlite");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.application !== "UNFEAL OS" || manifest.formatVersion !== 1 ||
        !Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion > migrations.length) {
      throw new Error("Unsupported or invalid UNFEAL Knowledge backup.");
    }
    const databaseStat = fs.lstatSync(databasePath);
    if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) throw new Error("Backup database must be a regular file.");
    const source = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      if (source.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup database failed its integrity check.");
      const tables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      if (!["memories", "documents", "relations", "memory_events", "sync_outbox"].every((table) => tables.has(table))) {
        throw new Error("Backup database is missing required Knowledge tables.");
      }
      if (!fs.statSync(path.join(backupDirectory, "vault")).isDirectory()) throw new Error("Backup Markdown vault is missing.");
      return { source, manifest, tables };
    } catch (error) {
      source.close();
      throw error;
    }
  }

  function inspectBackup(backupDirectory) {
    const { source, manifest, tables } = openBackupDatabase(backupDirectory);
    try {
      return {
        exportedAt: manifest.exportedAt,
        memories: source.prepare("SELECT COUNT(*) AS count FROM memories").get().count,
        documents: source.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        relations: source.prepare("SELECT COUNT(*) AS count FROM relations").get().count,
        historyEvents: source.prepare("SELECT COUNT(*) AS count FROM memory_events").get().count,
        outboxEntries: source.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get().count,
        chats: tables.has("chats") ? source.prepare("SELECT COUNT(*) AS count FROM chats").get().count : 0
      };
    } finally {
      source.close();
    }
  }

  function restoreBackup(backupDirectory) {
    const { source, tables } = openBackupDatabase(backupDirectory);
    const summary = { memories: 0, documents: 0, relations: 0, historyEvents: 0, outboxEntries: 0, chats: 0, chatMessages: 0, conflicts: 0 };
    const createdFiles = [];
    const timestamp = now();
    try {
      const memories = source.prepare("SELECT * FROM memories ORDER BY created_at, id").all();
      const documents = source.prepare("SELECT * FROM documents ORDER BY created_at, id").all();
      const relations = source.prepare("SELECT * FROM relations ORDER BY created_at, id").all();
      const events = source.prepare("SELECT * FROM memory_events ORDER BY created_at, id").all();
      const outboxEntries = source.prepare("SELECT * FROM sync_outbox ORDER BY created_at, id").all();
      const chats = tables.has("chats") ? source.prepare("SELECT * FROM chats ORDER BY created_at, id").all() : [];
      const chatMessages = tables.has("chat_messages") ? source.prepare("SELECT * FROM chat_messages ORDER BY chat_id, sequence").all() : [];
      db.transaction(() => {
        for (const item of memories) {
          if (!/^[a-f0-9-]{36}$/i.test(item.id) || typeof item.title !== "string" || item.title.length > MAX_TITLE ||
              typeof item.content !== "string" || item.content.length > MAX_CONTENT || typeof item.category !== "string" || item.category.length > 80 ||
              (item.source !== null && typeof item.source !== "string") || (typeof item.source === "string" && item.source.length > 500)) {
            summary.conflicts += 1;
            continue;
          }
          const current = db.prepare("SELECT * FROM memories WHERE id = ?").get(item.id);
          if (current) {
            if (current.title !== item.title || current.content !== item.content || current.category !== item.category || (current.source || "") !== (item.source || "") || current.deleted_at !== item.deleted_at) summary.conflicts += 1;
            continue;
          }
          const restored = {
            id: item.id, title: item.title, content: item.content, category: item.category,
            source: item.source ?? "", created_at: item.created_at || timestamp,
            updated_at: item.updated_at || timestamp, deleted_at: item.deleted_at || null
          };
          db.prepare("INSERT INTO memories (id, title, content, category, source, created_at, updated_at, deleted_at) VALUES (@id, @title, @content, @category, @source, @created_at, @updated_at, @deleted_at)").run(restored);
          addEvent.run(crypto.randomUUID(), "memory", restored.id, "restored_from_backup", JSON.stringify(restored), timestamp);
          addOutbox.run(crypto.randomUUID(), "memory", restored.id, restored.deleted_at ? "delete" : "upsert", JSON.stringify(restored), timestamp);
          summary.memories += 1;
        }

        for (const item of documents) {
          if (!/^[a-f0-9-]{36}$/i.test(item.id) || typeof item.title !== "string" || item.title.length > MAX_TITLE ||
              typeof item.content !== "string" || item.content.length > MAX_CONTENT || typeof item.category !== "string" || item.category.length > 80) {
            summary.conflicts += 1;
            continue;
          }
          const current = db.prepare("SELECT * FROM documents WHERE id = ?").get(item.id);
          if (current) {
            if (current.title !== item.title || current.content !== item.content || current.category !== item.category || current.deleted_at !== item.deleted_at) summary.conflicts += 1;
            continue;
          }
          const relativePath = documentRelativePath(item.id, Boolean(item.deleted_at));
          const absolutePath = resolveVaultPath(relativePath);
          if (fs.existsSync(absolutePath)) {
            summary.conflicts += 1;
            continue;
          }
          const restored = {
            id: item.id, title: item.title, content: item.content, category: item.category,
            path: relativePath, created_at: item.created_at || timestamp,
            updated_at: item.updated_at || timestamp, deleted_at: item.deleted_at || null
          };
          restored.vault_hash = markdownHash(restored);
          writeMarkdownFile(restored, relativePath);
          createdFiles.push(absolutePath);
          db.prepare("INSERT INTO documents (id, title, content, path, category, created_at, updated_at, deleted_at, vault_hash) VALUES (@id, @title, @content, @path, @category, @created_at, @updated_at, @deleted_at, @vault_hash)").run(restored);
          addEvent.run(crypto.randomUUID(), "document", restored.id, "restored_from_backup", JSON.stringify(restored), timestamp);
          addOutbox.run(crypto.randomUUID(), "document", restored.id, restored.deleted_at ? "delete" : "upsert", JSON.stringify(restored), timestamp);
          summary.documents += 1;
        }

        for (const relation of relations) {
          if (!/^[a-f0-9-]{36}$/i.test(relation.id) || !/^[a-f0-9-]{36}$/i.test(relation.source_id) ||
              !/^[a-f0-9-]{36}$/i.test(relation.target_id) || !["memory", "document"].includes(relation.source_type) ||
              !["memory", "document"].includes(relation.target_type) || typeof relation.relation_type !== "string" || relation.relation_type.length > 80) {
            summary.conflicts += 1;
            continue;
          }
          const exists = (type, id) => type === "memory"
            ? Boolean(db.prepare("SELECT 1 FROM memories WHERE id = ?").get(id))
            : Boolean(db.prepare("SELECT 1 FROM documents WHERE id = ?").get(id));
          if (!exists(relation.source_type, relation.source_id) || !exists(relation.target_type, relation.target_id)) {
            summary.conflicts += 1;
            continue;
          }
          const current = db.prepare("SELECT * FROM relations WHERE id = ?").get(relation.id);
          if (current) {
            if (current.source_type !== relation.source_type || current.source_id !== relation.source_id || current.target_type !== relation.target_type || current.target_id !== relation.target_id || current.relation_type !== relation.relation_type) summary.conflicts += 1;
            continue;
          }
          const duplicate = db.prepare("SELECT 1 FROM relations WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relation_type = ?").get(relation.source_type, relation.source_id, relation.target_type, relation.target_id, relation.relation_type);
          if (duplicate) continue;
          const restored = { ...relation, created_at: relation.created_at || timestamp };
          db.prepare("INSERT INTO relations (id, source_type, source_id, target_type, target_id, relation_type, created_at) VALUES (@id, @source_type, @source_id, @target_type, @target_id, @relation_type, @created_at)").run(restored);
          recordRelationChange("restored_from_backup", restored, timestamp);
          summary.relations += 1;
        }

        for (const event of events) {
          if (!/^[a-f0-9-]{36}$/i.test(event.id) || !["memory", "document", "relation"].includes(event.entity_type) ||
              !/^[a-f0-9-]{36}$/i.test(event.entity_id) || typeof event.action !== "string" || event.action.length > 80 ||
              (event.payload !== null && (typeof event.payload !== "string" || event.payload.length > MAX_CONTENT + 10000))) {
            summary.conflicts += 1;
            continue;
          }
          const current = db.prepare("SELECT * FROM memory_events WHERE id = ?").get(event.id);
          if (current) {
            if (current.entity_type !== event.entity_type || current.entity_id !== event.entity_id || current.action !== event.action || current.payload !== event.payload || current.created_at !== event.created_at) summary.conflicts += 1;
            continue;
          }
          db.prepare("INSERT INTO memory_events (id, entity_type, entity_id, action, payload, created_at) VALUES (@id, @entity_type, @entity_id, @action, @payload, @created_at)").run(event);
          summary.historyEvents += 1;
        }

        for (const entry of outboxEntries) {
          if (!/^[a-f0-9-]{36}$/i.test(entry.id) || !["memory", "document", "relation"].includes(entry.entity_type) ||
              !/^[a-f0-9-]{36}$/i.test(entry.entity_id) || !["upsert", "delete"].includes(entry.operation) ||
              typeof entry.payload !== "string" || entry.payload.length > MAX_CONTENT + 10000 || !Number.isInteger(entry.attempts) ||
              (entry.synced_at !== null && typeof entry.synced_at !== "string")) {
            summary.conflicts += 1;
            continue;
          }
          try { JSON.parse(entry.payload); } catch { summary.conflicts += 1; continue; }
          const current = db.prepare("SELECT * FROM sync_outbox WHERE id = ?").get(entry.id);
          if (current) {
            if (current.entity_type !== entry.entity_type || current.entity_id !== entry.entity_id || current.operation !== entry.operation || current.payload !== entry.payload || current.created_at !== entry.created_at || current.synced_at !== entry.synced_at) summary.conflicts += 1;
            continue;
          }
          db.prepare("INSERT INTO sync_outbox (id, entity_type, entity_id, operation, payload, created_at, attempts, synced_at) VALUES (@id, @entity_type, @entity_id, @operation, @payload, @created_at, @attempts, @synced_at)").run(entry);
          summary.outboxEntries += 1;
        }

        for (const chat of chats) {
          if (!/^[a-f0-9-]{36}$/i.test(chat.id) || typeof chat.title !== "string" || chat.title.length > MAX_TITLE ||
              typeof chat.model !== "string" || !chat.model.trim() || chat.model.length > 2000) {
            summary.conflicts += 1;
            continue;
          }
          const current = db.prepare("SELECT * FROM chats WHERE id = ?").get(chat.id);
          if (current) {
            if (current.title !== chat.title || current.model !== chat.model) summary.conflicts += 1;
            continue;
          }
          db.prepare("INSERT INTO chats (id, title, model, created_at, updated_at) VALUES (@id, @title, @model, @created_at, @updated_at)").run(chat);
          summary.chats += 1;
        }

        for (const message of chatMessages) {
          if (!/^[a-f0-9-]{36}$/i.test(message.id) || !/^[a-f0-9-]{36}$/i.test(message.chat_id) ||
              !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 20000 ||
              !db.prepare("SELECT 1 FROM chats WHERE id = ?").get(message.chat_id)) {
            summary.conflicts += 1;
            continue;
          }
          const current = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(message.id);
          if (current) {
            if (current.chat_id !== message.chat_id || current.role !== message.role || current.content !== message.content) summary.conflicts += 1;
            continue;
          }
          const sequence = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM chat_messages WHERE chat_id = ?").get(message.chat_id).value + 1;
          db.prepare("INSERT INTO chat_messages (id, chat_id, sequence, role, content, created_at) VALUES (@id, @chat_id, @sequence, @role, @content, @created_at)").run({ ...message, sequence });
          db.prepare("UPDATE chats SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(message.created_at, message.chat_id);
          summary.chatMessages += 1;
        }
      })();
      return summary;
    } catch (error) {
      for (const file of createdFiles) if (fs.existsSync(file)) fs.unlinkSync(file);
      throw error;
    } finally {
      source.close();
    }
  }

  return {
    listMemories: () => list("memory"), createMemory: (input) => create("memory", input),
    updateMemory: (id, input) => update("memory", id, input), deleteMemory: (id) => remove("memory", id),
    listDocuments: () => list("document"), createDocument: (input) => create("document", input),
    updateDocument: (id, input) => update("document", id, input), deleteDocument: (id) => remove("document", id),
    listRelations, createRelation, updateRelation, deleteRelation,
    search, syncMarkdownVault, listHistory, listPendingSync, exportBackup, inspectBackup, restoreBackup,
    listChats, searchChats, getChat, saveChatTurn, deleteChat, renameChat,
    findChatMemory: (chatId) => db.prepare("SELECT * FROM memories WHERE source = ? AND deleted_at IS NULL").get(`chat:${chatId}`),
    getSchemaVersion: () => migrations.length,
    close: () => db.close()
  };
}

module.exports = { createKnowledgeStore };

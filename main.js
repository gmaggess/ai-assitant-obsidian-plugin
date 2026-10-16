"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AIWriterAssistantPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// src/view.ts
var import_obsidian5 = require("obsidian");

// src/context.ts
async function buildContext(app, scope, includeSubfolders, maxChars, folderPath) {
  const active = app.workspace.getActiveFile();
  let files = [];
  let label = "";
  if (scope === "file") {
    if (!active) throw new Error("No active file. Open a note to use File scope.");
    files = [active];
    label = `File: ${active.path}`;
  } else if (scope === "folder") {
    const folder = folderPath !== void 0 ? app.vault.getFolderByPath?.(folderPath) ?? app.vault.getRoot() : active?.parent ?? app.vault.getRoot();
    const path = folder?.path ?? "/";
    files = app.vault.getMarkdownFiles().filter((f) => {
      const parent = f.parent?.path ?? "/";
      if (includeSubfolders) return path === "/" || f.path.startsWith(path + "/");
      return parent === path;
    });
    label = `Folder: ${path}${includeSubfolders ? " (+subfolders)" : ""}`;
  } else {
    files = app.vault.getMarkdownFiles();
    label = "Vault";
  }
  if (active) files.sort((a, b) => a === active ? -1 : b === active ? 1 : a.path.localeCompare(b.path));
  let text = "";
  let truncated = false;
  for (const f of files) {
    const body = await app.vault.cachedRead(f);
    const chunk = `<note path="${f.path}">
${body}
</note>

`;
    if (text.length + chunk.length > maxChars) {
      const remaining = maxChars - text.length;
      if (remaining > 500) text += chunk.slice(0, remaining) + "\n\u2026[truncated]</note>\n";
      truncated = true;
      break;
    }
    text += chunk;
  }
  return { label, files, text, truncated };
}

// src/providers.ts
var import_obsidian = require("obsidian");

// src/data.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordOf(value) {
  return isRecord(value) ? value : {};
}
function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}
function recordsOf(value) {
  return arrayOf(value).filter(isRecord);
}
function parseJson(text) {
  return JSON.parse(text);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function toolString(value) {
  if (typeof value !== "string" || !value) throw new Error("Invalid provider tool call.");
  return value;
}

// src/providers.ts
var ADAPTIVE_ONLY = /* @__PURE__ */ new Set();
var THINKING_BUDGET = { low: 2048, medium: 6e3, high: 16e3, xhigh: 24e3, max: 32e3 };
function errMsg(status, body) {
  const data = recordOf(body);
  const m = recordOf(data.error).message ?? data.message ?? JSON.stringify(body);
  return `API error ${status}: ${typeof m === "string" ? m : JSON.stringify(m)}`;
}
async function sendChat(s, system, messages, tools) {
  return s.provider === "anthropic" ? sendAnthropic(s, system, messages, tools) : sendOpenAI(s, system, messages, tools);
}
async function sendAnthropic(s, system, messages, tools) {
  if (!s.anthropicApiKey) throw new Error("Add your Anthropic API key in plugin settings.");
  const msgs = [...messages];
  const body = { model: s.anthropicModel, max_tokens: s.maxOutputTokens, system, messages: msgs };
  if (tools) body.tools = tools.defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.schema }));
  const useAdaptive = () => {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: s.effort };
  };
  if (s.anthropicEffortMode === "thinking-budget" && ADAPTIVE_ONLY.has(s.anthropicModel)) {
    useAdaptive();
  } else if (s.anthropicEffortMode === "effort") {
    body.output_config = { effort: s.effort };
  } else if (s.anthropicEffortMode === "thinking-budget") {
    const budget = Math.min(THINKING_BUDGET[s.effort], Math.max(1024, s.maxOutputTokens - 1024));
    body.thinking = { type: "enabled", budget_tokens: budget };
    if (body.max_tokens <= budget) body.max_tokens = budget + 2048;
  }
  const texts = [];
  for (let round = 0; round < (s.maxToolRounds || 25); round++) {
    const call = () => (0, import_obsidian.requestUrl)({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      throw: false,
      headers: {
        "content-type": "application/json",
        "x-api-key": s.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
    let res = await call();
    if (res.status === 400 && body.thinking?.type === "enabled" && /thinking\.type\.enabled|adaptive/i.test(JSON.stringify(res.json))) {
      ADAPTIVE_ONLY.add(s.anthropicModel);
      useAdaptive();
      res = await call();
    }
    if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
    const data = recordOf(res.json);
    if (data.stop_reason === "refusal") return "_The model declined to answer this request._";
    const content = recordsOf(data.content);
    const text = content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
    if (text) texts.push(text);
    const calls = content.filter((b) => b.type === "tool_use");
    if (!tools || data.stop_reason !== "tool_use" || calls.length === 0) return texts.join("\n\n");
    msgs.push({ role: "assistant", content });
    const results = [];
    for (const c of calls) {
      const name = toolString(c.name);
      const id = toolString(c.id);
      let out;
      try {
        out = await tools.run(name, c.input);
      } catch (e) {
        out = `Error: ${errorMessage(e)}`;
      }
      results.push({ type: "tool_result", tool_use_id: id, content: out });
    }
    msgs.push({ role: "user", content: results });
  }
  texts.push("_(stopped after too many tool steps)_");
  return texts.join("\n\n");
}
async function sendOpenAI(s, system, messages, tools) {
  if (!s.openaiApiKey) throw new Error("Add your OpenAI API key in plugin settings.");
  const effort = s.effort === "max" || s.effort === "xhigh" ? "high" : s.effort;
  const input = messages.map((m) => ({ role: m.role, content: m.content }));
  const body = {
    model: s.openaiModel,
    instructions: system,
    input,
    max_output_tokens: s.maxOutputTokens,
    store: false,
    reasoning: { effort }
  };
  if (tools) {
    body.tools = tools.defs.map((d) => ({ type: "function", name: d.name, description: d.description, parameters: d.schema }));
    body.include = ["reasoning.encrypted_content"];
  }
  const texts = [];
  for (let round = 0; round < (s.maxToolRounds || 25); round++) {
    let res = await post(s, body);
    if (res.status === 400 && /reasoning/i.test(JSON.stringify(res.json))) {
      delete body.reasoning;
      delete body.include;
      res = await post(s, body);
    }
    if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
    const data = recordOf(res.json);
    const output = recordsOf(data.output);
    const calls = output.filter((i) => i.type === "function_call");
    if (!tools || calls.length === 0) {
      const parts = [];
      if (typeof data.output_text === "string" && data.output_text) parts.push(data.output_text);
      else for (const item of output) {
        if (item.type === "message") {
          for (const c of recordsOf(item.content)) if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
        }
      }
      if (parts.length) texts.push(parts.join("\n"));
      return texts.join("\n\n") || "_(empty response \u2014 try raising Max output tokens)_";
    }
    for (const item of output) {
      if (item.type === "message") {
        for (const c of recordsOf(item.content)) if (c.type === "output_text" && typeof c.text === "string") texts.push(c.text);
      }
    }
    input.push(...output);
    for (const c of calls) {
      const name = toolString(c.name);
      const id = toolString(c.call_id);
      let out;
      try {
        out = await tools.run(name, parseJson(toolString(c.arguments)));
      } catch (e) {
        out = `Error: ${errorMessage(e)}`;
      }
      input.push({ type: "function_call_output", call_id: id, output: out });
    }
  }
  texts.push("_(stopped after too many tool steps)_");
  return texts.join("\n\n");
}
function post(s, body) {
  return (0, import_obsidian.requestUrl)({
    url: "https://api.openai.com/v1/responses",
    method: "POST",
    throw: false,
    headers: { "content-type": "application/json", authorization: `Bearer ${s.openaiApiKey}` },
    body: JSON.stringify(body)
  });
}
async function fetchModels(s, provider) {
  if (provider === "anthropic") {
    const res2 = await (0, import_obsidian.requestUrl)({
      url: "https://api.anthropic.com/v1/models?limit=100",
      throw: false,
      headers: { "x-api-key": s.anthropicApiKey, "anthropic-version": "2023-06-01" }
    });
    if (res2.status >= 400) throw new Error(errMsg(res2.status, res2.json));
    return recordsOf(recordOf(res2.json).data).flatMap((m) => typeof m.id === "string" ? [m.id] : []);
  }
  const res = await (0, import_obsidian.requestUrl)({
    url: "https://api.openai.com/v1/models",
    throw: false,
    headers: { authorization: `Bearer ${s.openaiApiKey}` }
  });
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  return recordsOf(recordOf(res.json).data).flatMap((m) => typeof m.id === "string" ? [m.id] : []).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search)/.test(id)).sort();
}

// src/history.ts
function isConversation(value) {
  if (!isRecord(value)) return false;
  return [value.id, value.title, value.scopeLabel, value.provider, value.model].every((v) => typeof v === "string") && (value.scope === "file" || value.scope === "folder" || value.scope === "vault") && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && (value.folderPath === void 0 || typeof value.folderPath === "string") && (value.effort === void 0 || typeof value.effort === "string") && Array.isArray(value.messages) && arrayOf(value.messages).every((m) => isRecord(m) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
}
var HistoryStore = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.items = [];
  }
  get path() {
    return `${this.plugin.manifest.dir}/history.json`;
  }
  async load() {
    const a = this.plugin.app.vault.adapter;
    try {
      if (await a.exists(this.path)) this.items = arrayOf(parseJson(await a.read(this.path))).filter(isConversation);
    } catch {
      this.items = [];
    }
  }
  async persist() {
    await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(this.items));
  }
  all() {
    return [...this.items].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  get(id) {
    return this.items.find((c) => c.id === id);
  }
  async upsert(c) {
    const i = this.items.findIndex((x) => x.id === c.id);
    if (i >= 0) this.items[i] = c;
    else this.items.push(c);
    await this.persist();
  }
  async remove(id) {
    this.items = this.items.filter((c) => c.id !== id);
    await this.persist();
  }
  async clear() {
    this.items = [];
    await this.persist();
  }
};
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// src/search.ts
var import_obsidian2 = require("obsidian");
var PER_CHAT_CHARS = 2500;
var MAX_CANDIDATES = 200;
function digest(c) {
  let body = c.messages.map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`).join("\n");
  if (body.length > PER_CHAT_CHARS) body = body.slice(0, PER_CHAT_CHARS) + " \u2026";
  return `<chat id="${c.id}" date="${new Date(c.updatedAt).toISOString().slice(0, 10)}" scope="${c.scopeLabel}">
${body}
</chat>`;
}
function parseResult(text, valid) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The model didn't return a readable result. Try again.");
  const raw = recordOf(parseJson(m[0]));
  return {
    summary: typeof raw.summary === "string" ? raw.summary : "",
    matches: recordsOf(raw.matches).filter((x) => typeof x.id === "string" && valid.has(x.id)).map((x) => ({ id: String(x.id), reason: typeof x.reason === "string" ? x.reason : "" }))
  };
}
async function searchHistory(plugin, query) {
  const chats = plugin.history.all().slice(0, MAX_CANDIDATES);
  if (!chats.length) return { summary: "You don't have any saved conversations yet.", matches: [] };
  const system = `You search a user's past AI conversations about their Obsidian notes. Given a natural-language query and a list of chats, pick the chats that are genuinely relevant (best first, max 8) and write a concise markdown summary of what those chats concluded about the query, mentioning dates or note paths when useful. Reply with ONLY a JSON object: {"summary": string, "matches": [{"id": string, "reason": string}]}. If nothing is relevant, return {"summary": "No relevant conversations found.", "matches": []}.`;
  const user = `Query: ${query}

${chats.map(digest).join("\n\n")}`;
  const settings = { ...plugin.settings, anthropicEffortMode: "none", effort: "low" };
  const text = await sendChat(settings, system, [{ role: "user", content: user }]);
  return parseResult(text, new Set(chats.map((c) => c.id)));
}
var SearchModal = class extends import_obsidian2.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.comp = new import_obsidian2.Component();
  }
  onOpen() {
    this.comp.load();
    const { contentEl } = this;
    this.titleEl.setText("Search past conversations");
    const row = contentEl.createDiv("sac-input-row");
    const input = row.createEl("input", { type: "text", cls: "sac-search-input", attr: { placeholder: "Search your past conversations" } });
    const btn = row.createEl("button", { text: "Search", cls: "mod-cta" });
    const out = contentEl.createDiv({ cls: "sac-search-out" });
    contentEl.createDiv({ cls: "sac-scope-info", text: `${this.plugin.history.all().length} saved conversation(s). Uses your selected provider and model.` });
    const run = async () => {
      const q = input.value.trim();
      if (!q) return;
      btn.disabled = true;
      out.empty();
      out.createDiv({ text: "Searching\u2026", cls: "sac-scope-info" });
      try {
        const res = await searchHistory(this.plugin, q);
        out.empty();
        const sum = out.createDiv("sac-msg assistant");
        await import_obsidian2.MarkdownRenderer.render(this.app, res.summary || "_No summary._", sum, "", this.comp);
        for (const m of res.matches) {
          const c = this.plugin.history.get(m.id);
          const card = out.createDiv("sac-result");
          card.createDiv({ cls: "sac-result-title", text: c.title });
          card.createDiv({ cls: "sac-scope-info", text: `${new Date(c.updatedAt).toLocaleString()} \xB7 ${c.scopeLabel} \xB7 ${c.model}` });
          card.createDiv({ text: m.reason });
          card.onclick = async () => {
            this.close();
            await this.plugin.openConversation(c.id);
          };
        }
      } catch (e) {
        out.empty();
        out.createDiv({ cls: "sac-msg error", text: errorMessage(e) });
        new import_obsidian2.Notice("Search failed");
      } finally {
        btn.disabled = false;
      }
    };
    btn.onclick = run;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void run();
    });
    input.focus();
  }
  onClose() {
    this.comp.unload();
    this.contentEl.empty();
  }
};

// src/export.ts
var import_obsidian3 = require("obsidian");
var providerName = (p) => p === "anthropic" ? "Claude" : p === "openai" ? "ChatGPT" : p;
var yaml = (v) => JSON.stringify(v);
function conversationToMarkdown(c) {
  const fm = [
    "---",
    `title: ${yaml(c.title)}`,
    `provider: ${yaml(providerName(c.provider))}`,
    `model: ${yaml(c.model)}`,
    ...c.effort ? [`effort: ${yaml(c.effort)}`] : [],
    `scope: ${yaml(c.scope)}`,
    `scope_target: ${yaml(c.scopeLabel)}`,
    `created: ${new Date(c.createdAt).toISOString()}`,
    `updated: ${new Date(c.updatedAt).toISOString()}`,
    `messages: ${c.messages.length}`,
    "tags: [ai-chat]",
    "---"
  ].join("\n");
  const details = [
    `> [!info] Conversation details`,
    `> **Model:** ${providerName(c.provider)} \xB7 \`${c.model}\`${c.effort ? ` \xB7 effort ${c.effort}` : ""}`,
    `> **Scope:** ${c.scope} \u2014 ${c.scopeLabel}`,
    `> **Date:** ${new Date(c.createdAt).toLocaleString()}`
  ].join("\n");
  const body = c.messages.map((m) => `## ${m.role === "user" ? "\u{1F9D1} You" : `\u{1F916} ${providerName(c.provider)}`}

${m.content.trim()}`).join("\n\n");
  return `${fm}

# ${c.title}

${details}

${body}
`;
}
async function saveConversationNote(app, c, folder) {
  const dir = (0, import_obsidian3.normalizePath)(folder.trim() || "AI Chats");
  if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
  const d = new Date(c.createdAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const safe = c.title.replace(/[\\/:*?"<>|#^[\]\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Chat";
  let path = (0, import_obsidian3.normalizePath)(`${dir}/${stamp} ${safe}.md`);
  for (let i = 2; app.vault.getAbstractFileByPath(path); i++) path = (0, import_obsidian3.normalizePath)(`${dir}/${stamp} ${safe} (${i}).md`);
  return app.vault.create(path, conversationToMarkdown(c));
}

// src/types.ts
var DEFAULT_SETTINGS = {
  anthropicApiKey: "",
  openaiApiKey: "",
  provider: "anthropic",
  anthropicModel: "claude-sonnet-4-5",
  openaiModel: "gpt-5",
  anthropicModels: ["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openaiModels: ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
  effort: "medium",
  anthropicEffortMode: "thinking-budget",
  defaultScope: "file",
  includeSubfolders: false,
  maxContextChars: 2e5,
  maxOutputTokens: 8e3,
  notesFolder: "AI Chats",
  allowEdits: true,
  requireApproval: true,
  maxToolRounds: 25,
  systemPrompt: "You are a helpful assistant inside the user's Obsidian vault. Answer ONLY using the notes provided in the context. If the answer is not in the provided notes, say so. Cite note paths when relevant."
};
function editModeOf(s) {
  return !s.allowEdits ? "off" : s.requireApproval ? "ask" : "auto";
}
function loadSettings(value) {
  const raw = recordOf(value);
  const defaults = DEFAULT_SETTINGS;
  const text = (key) => typeof raw[key] === "string" ? raw[key] : defaults[key];
  const number = (key) => {
    const n = raw[key];
    return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && (key !== "maxToolRounds" || n <= 200) ? n : defaults[key];
  };
  const list = (key) => Array.isArray(raw[key]) ? arrayOf(raw[key]).filter((v) => typeof v === "string") : [...defaults[key]];
  const result = { ...defaults, anthropicModels: list("anthropicModels"), openaiModels: list("openaiModels") };
  for (const key of ["anthropicApiKey", "openaiApiKey", "anthropicModel", "openaiModel", "systemPrompt", "notesFolder"]) {
    const candidate = text(key);
    if (typeof candidate === "string") result[key] = candidate;
  }
  for (const key of ["allowEdits", "requireApproval", "includeSubfolders"]) {
    const candidate = raw[key];
    if (typeof candidate === "boolean") result[key] = candidate;
  }
  result.maxContextChars = number("maxContextChars");
  result.maxOutputTokens = number("maxOutputTokens");
  result.maxToolRounds = number("maxToolRounds");
  if (raw.provider === "anthropic" || raw.provider === "openai") result.provider = raw.provider;
  if (raw.defaultScope === "file" || raw.defaultScope === "folder" || raw.defaultScope === "vault") result.defaultScope = raw.defaultScope;
  if (raw.anthropicEffortMode === "effort" || raw.anthropicEffortMode === "thinking-budget" || raw.anthropicEffortMode === "none") result.anthropicEffortMode = raw.anthropicEffortMode;
  if (raw.effort === "low" || raw.effort === "medium" || raw.effort === "high" || raw.effort === "xhigh" || raw.effort === "max") result.effort = raw.effort;
  return result;
}

// src/tools.ts
var import_obsidian4 = require("obsidian");
var TOOL_DEFS = [
  {
    name: "read_note",
    description: "Read the full current contents of a note in the vault.",
    schema: { type: "object", properties: { path: { type: "string", description: "Vault-relative path, e.g. Projects/Plan.md" } }, required: ["path"] }
  },
  {
    name: "edit_note",
    description: "Replace one exact passage in an existing note. old_text must match the note exactly and occur once; include enough surrounding text to be unique.",
    schema: {
      type: "object",
      properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
      required: ["path", "old_text", "new_text"]
    }
  },
  {
    name: "append_to_note",
    description: "Add text to the end of an existing note.",
    schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
  },
  {
    name: "create_note",
    description: "Create a new note (and any missing folders). Fails if the note already exists.",
    schema: { type: "object", properties: { path: { type: "string", description: "Vault-relative path ending in .md" }, content: { type: "string" } }, required: ["path", "content"] }
  }
];
var EDIT_INSTRUCTIONS = "\n\nYou can read and modify notes in the vault with the provided tools. Only change notes when the user asks you to. Prefer edit_note with a small, unique old_text over rewriting whole notes. Paths are vault-relative. If the user declines a change, do not retry it; acknowledge it and move on.";
function applyEdit(content, oldText, newText) {
  if (!oldText) return { ok: false, error: "old_text is empty." };
  const first = content.indexOf(oldText);
  if (first === -1) return { ok: false, error: "old_text was not found in the note. Read the note again and copy the passage exactly." };
  if (content.indexOf(oldText, first + oldText.length) !== -1) return { ok: false, error: "old_text occurs more than once. Include more surrounding text to make it unique." };
  return { ok: true, content: content.slice(0, first) + newText + content.slice(first + oldText.length) };
}
function checkPath(path, configDir) {
  if (typeof path !== "string" || !path.trim()) return "path is required.";
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "path must be vault-relative.";
  const parts = path.split(/[\\/]/);
  if (parts.includes("..")) return "path must not contain '..'.";
  if (parts[0] === configDir) return "the vault configuration folder is off limits.";
  return null;
}
var VaultTools = class {
  constructor(app, mode, confirm) {
    this.app = app;
    this.mode = mode;
    this.confirm = confirm;
    this.defs = TOOL_DEFS;
    this.modified = /* @__PURE__ */ new Set();
  }
  async run(name, value) {
    const input = recordOf(value);
    const bad = checkPath(input.path, this.app.vault.configDir);
    if (bad) return `Error: ${bad}`;
    if (typeof input.path !== "string") return "Error: path is required.";
    for (const key of ["content", "old_text", "new_text"]) {
      if (input[key] !== void 0 && typeof input[key] !== "string") return `Error: ${key} must be text.`;
    }
    const content = typeof input.content === "string" ? input.content : "";
    const oldText = typeof input.old_text === "string" ? input.old_text : "";
    const newText = typeof input.new_text === "string" ? input.new_text : "";
    const path = (0, import_obsidian4.normalizePath)(input.path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (name === "read_note") {
      if (!(existing instanceof import_obsidian4.TFile)) return `Error: no note at ${path}.`;
      return await this.app.vault.read(existing);
    }
    if (this.mode() === "off") return "Error: file editing is disabled in settings.";
    if (name === "create_note") {
      if (existing) return `Error: ${path} already exists. Use edit_note or append_to_note.`;
      if (!await this.approve({ kind: "create", path, content })) return "The user declined this change.";
      const slash = path.lastIndexOf("/");
      if (slash > 0) await this.ensureFolder(path.slice(0, slash));
      await this.app.vault.create(path, content);
      this.modified.add(path);
      return `Created ${path}.`;
    }
    if (name === "edit_note" || name === "append_to_note") {
      if (!(existing instanceof import_obsidian4.TFile)) return `Error: no note at ${path}.`;
      const current = await this.app.vault.read(existing);
      let next;
      let req;
      if (name === "edit_note") {
        const r = applyEdit(current, oldText, newText);
        if (!r.ok) return `Error: ${r.error}`;
        next = r.content;
        req = { kind: "edit", path, oldText, newText };
      } else {
        const add = content;
        next = current + (current.endsWith("\n") || !current ? "" : "\n") + add;
        req = { kind: "append", path, content: add };
      }
      if (!await this.approve(req)) return "The user declined this change.";
      await this.app.vault.modify(existing, next);
      this.modified.add(path);
      return `Updated ${path}.`;
    }
    return `Error: unknown tool ${name}.`;
  }
  async approve(c) {
    return this.mode() === "auto" ? true : this.confirm(c);
  }
  async ensureFolder(folder) {
    let acc = "";
    for (const part of folder.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(acc)) await this.app.vault.createFolder(acc);
    }
  }
};

// src/view.ts
var VIEW_TYPE = "ai-writer-assistant-view";
var FolderPickerModal = class extends import_obsidian5.FuzzySuggestModal {
  constructor(app, onPick) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder("Choose a folder for context\u2026");
  }
  getItems() {
    return this.app.vault.getAllFolders(true);
  }
  getItemText(f) {
    return f.isRoot() ? "/" : f.path;
  }
  onChooseItem(f) {
    this.onPick(f);
  }
};
var ChatView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.busy = false;
    this.cancel = null;
    this.declinePending = null;
    this.convId = null;
    this.convCreated = 0;
    this.chatScope = plugin.settings.defaultScope;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return this.plugin.manifest.name;
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    this.render();
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateScopeInfo()));
  }
  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("sac-view");
    const bar = root.createDiv("sac-toolbar");
    const actions = bar.createDiv("sac-actions");
    const action = (icon, label) => {
      const button = actions.createEl("button", { cls: "clickable-icon sac-icon-button", attr: { "aria-label": label, type: "button" } });
      (0, import_obsidian5.setIcon)(button, icon);
      (0, import_obsidian5.setTooltip)(button, label);
      return button;
    };
    const clear = action("square-pen", "New chat");
    const search = action("search", "Search history");
    search.onclick = () => new SearchModal(this.app, this.plugin).open();
    const saveNote = action("file-down", "Save as note");
    saveNote.onclick = () => this.saveAsNote();
    this.scopeButton = action("scan-search", "Scope");
    this.scopeButton.onclick = (e) => this.showScopeMenu(e);
    clear.onclick = () => {
      this.messages = [];
      this.convId = null;
      this.messagesEl.empty();
    };
    this.updateScopeInfo();
    this.messagesEl = root.createDiv("sac-messages");
    const row = root.createDiv("sac-input-row");
    const input = row.createEl("textarea", { attr: { placeholder: "Ask about your notes\u2026 (Enter to send, Shift+Enter for newline)" } });
    const send = row.createEl("button", { text: "Send", cls: "mod-cta" });
    const submit = async () => {
      const text = input.value.trim();
      if (!text || this.busy) return;
      input.value = "";
      await this.ask(text, send);
    };
    send.onclick = () => {
      if (this.busy) this.cancel?.();
      else void submit();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submit();
      }
    });
  }
  async loadConversation(id) {
    const c = this.plugin.history.get(id);
    if (!c) return;
    this.convId = c.id;
    this.convCreated = c.createdAt;
    this.messages = [...c.messages];
    this.chatScope = c.scope;
    this.chatFolder = c.scope === "folder" ? c.folderPath : void 0;
    this.updateScopeInfo();
    this.messagesEl.empty();
    this.messagesEl.createDiv({ cls: "sac-scope-info", text: `Resumed chat from ${new Date(c.updatedAt).toLocaleString()} (${c.scopeLabel})` });
    for (const m of c.messages) {
      const el = this.messagesEl.createDiv({ cls: `sac-msg ${m.role}` });
      if (m.role === "user") el.setText(m.content);
      else await import_obsidian5.MarkdownRenderer.render(this.app, m.content, el, "", this);
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
  async saveAsNote() {
    const c = this.convId ? this.plugin.history.get(this.convId) : void 0;
    if (!c || c.messages.length === 0) {
      new import_obsidian5.Notice("Nothing to save yet \u2014 send a message first.");
      return;
    }
    try {
      const file = await saveConversationNote(this.app, c, this.plugin.settings.notesFolder);
      new import_obsidian5.Notice(`Saved to ${file.path}`);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      new import_obsidian5.Notice(`Couldn't save note: ${errorMessage(e)}`);
    }
  }
  askApproval(c, before) {
    return new Promise((resolve) => {
      const card = this.messagesEl.createDiv("sac-change");
      this.messagesEl.insertBefore(card, before);
      const verb = c.kind === "create" ? "Create" : c.kind === "append" ? "Append to" : "Edit";
      card.createDiv({ cls: "sac-change-title", text: `${verb} ${c.path}` });
      const diff = card.createEl("pre", { cls: "sac-diff" });
      const clip = (t) => t.length > 1500 ? t.slice(0, 1500) + "\n\u2026" : t;
      if (c.kind === "edit") {
        diff.createDiv({ cls: "sac-diff-del", text: clip(c.oldText) });
        diff.createDiv({ cls: "sac-diff-add", text: clip(c.newText) });
      } else diff.createDiv({ cls: "sac-diff-add", text: clip(c.content) });
      const row = card.createDiv("sac-change-actions");
      const apply = row.createEl("button", { text: "Apply", cls: "mod-cta" });
      const reject = row.createEl("button", { text: "Reject" });
      const done = (ok) => {
        this.declinePending = null;
        row.remove();
        card.createDiv({ cls: "sac-scope-info", text: ok ? "Applied" : "Rejected" });
        resolve(ok);
      };
      apply.onclick = () => done(true);
      reject.onclick = () => done(false);
      this.declinePending = () => done(false);
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }
  showScopeMenu(e) {
    const menu = new import_obsidian5.Menu();
    const choose = (scope, title, icon, onPick) => menu.addItem((i) => i.setTitle(title).setIcon(icon).setChecked(this.chatScope === scope).onClick(onPick));
    choose("file", "File", "file", () => {
      this.chatScope = "file";
      this.updateScopeInfo();
    });
    choose("folder", "Active note's folder", "folder", () => {
      this.chatScope = "folder";
      this.chatFolder = void 0;
      this.updateScopeInfo();
    });
    menu.addItem((i) => i.setTitle("Choose folder\u2026").setIcon("folder-search").onClick(() => new FolderPickerModal(this.app, (f) => {
      this.chatScope = "folder";
      this.chatFolder = f.path;
      this.updateScopeInfo();
    }).open()));
    choose("vault", "Vault", "vault", () => {
      this.chatScope = "vault";
      this.updateScopeInfo();
    });
    menu.showAtMouseEvent(e);
  }
  updateScopeInfo() {
    if (!this.scopeButton) return;
    const active = this.app.workspace.getActiveFile();
    const t = this.chatScope === "file" ? active?.path ?? "no file open" : this.chatScope === "folder" ? this.chatFolder ?? active?.parent?.path ?? "/" : `${this.app.vault.getMarkdownFiles().length} notes`;
    this.scopeButton.toggleClass("is-active", this.chatScope !== "file");
    (0, import_obsidian5.setTooltip)(this.scopeButton, `Context: ${this.chatScope} \u2014 ${t}`);
  }
  async ask(text, sendBtn) {
    this.busy = true;
    sendBtn.setText("Stop");
    sendBtn.removeClass("mod-cta");
    sendBtn.addClass("mod-warning");
    let stopped = false;
    const stopPromise = new Promise((_, reject) => {
      this.cancel = () => {
        stopped = true;
        this.declinePending?.();
        reject(new Error("Stopped"));
      };
    });
    stopPromise.catch(() => {
    });
    this.messages.push({ role: "user", content: text });
    this.messagesEl.createDiv({ cls: "sac-msg user", text });
    const pending = this.messagesEl.createDiv({ cls: "sac-msg assistant", text: "Thinking\u2026" });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    try {
      const s = this.plugin.settings;
      const ctx = await buildContext(this.app, this.chatScope, s.includeSubfolders, s.maxContextChars, this.chatScope === "folder" ? this.chatFolder : void 0);
      if (ctx.truncated) new import_obsidian5.Notice("Context was truncated to fit max context characters.");
      const tools = editModeOf(s) === "off" ? void 0 : new VaultTools(this.app, () => editModeOf(this.plugin.settings), (c) => this.askApproval(c, pending));
      const system = `${s.systemPrompt}${tools ? EDIT_INSTRUCTIONS : ""}

Scope: ${ctx.label} (${ctx.files.length} note(s)${ctx.truncated ? ", truncated" : ""})

<context>
${ctx.text}</context>`;
      let reply = await Promise.race([sendChat(s, system, this.messages, tools), stopPromise]);
      if (tools && tools.modified.size) reply += `

---
_Modified: ${[...tools.modified].map((p) => `[[${p}]]`).join(", ")}_`;
      this.messages.push({ role: "assistant", content: reply });
      if (!this.convId) {
        this.convId = newId();
        this.convCreated = Date.now();
      }
      const conv = {
        id: this.convId,
        title: this.messages[0].content.slice(0, 80),
        scope: this.chatScope,
        folderPath: this.chatScope === "folder" ? this.chatFolder : void 0,
        scopeLabel: ctx.label,
        provider: s.provider,
        model: s.provider === "anthropic" ? s.anthropicModel : s.openaiModel,
        effort: s.effort,
        createdAt: this.convCreated,
        updatedAt: Date.now(),
        messages: [...this.messages]
      };
      await this.plugin.history.upsert(conv);
      pending.empty();
      await import_obsidian5.MarkdownRenderer.render(this.app, reply, pending, "", this);
    } catch (e) {
      this.messages.pop();
      if (stopped) {
        pending.setText("Stopped.");
        pending.addClass("sac-scope-info");
      } else {
        pending.addClass("error");
        pending.setText(errorMessage(e));
      }
    } finally {
      this.busy = false;
      this.cancel = null;
      sendBtn.setText("Send");
      sendBtn.removeClass("mod-warning");
      sendBtn.addClass("mod-cta");
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
};

// src/settings.ts
var import_obsidian6 = require("obsidian");

// src/donation.ts
var DONATION_URL = "https://account.venmo.com/u/gmaggess";

// src/settings.ts
var SettingsTab = class extends import_obsidian6.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.legacyCleanups = [];
  }
  getSettingDefinitions() {
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    const row = (name, desc, render, visible) => ({ name, desc, render, visible });
    const models = ["anthropic", "openai"].map((p) => {
      const label = p === "anthropic" ? "Claude" : "ChatGPT";
      return row(`${label} model`, "Pick from the list, or type any model ID.", (setting) => {
        setting.addDropdown((d) => {
          const list = p === "anthropic" ? s.anthropicModels : s.openaiModels;
          list.forEach((m) => {
            d.addOption(m, m);
          });
          d.setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel).onChange(async (v) => {
            if (p === "anthropic") s.anthropicModel = v;
            else s.openaiModel = v;
            await save();
            this.refreshSettings();
          });
        }).addText((t) => t.setPlaceholder("Custom model ID").setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel).onChange(async (v) => {
          if (p === "anthropic") s.anthropicModel = v.trim();
          else s.openaiModel = v.trim();
          await save();
        })).addButton((b) => b.setButtonText("Refresh list").onClick(async () => {
          try {
            const models2 = await fetchModels(s, p);
            if (!models2.length) throw new Error("No models returned");
            if (p === "anthropic") s.anthropicModels = models2;
            else s.openaiModels = models2;
            await save();
            new import_obsidian6.Notice(`Loaded ${models2.length} ${label} models`);
            this.refreshSettings();
          } catch (e) {
            new import_obsidian6.Notice(errorMessage(e));
          }
        }));
      });
    });
    return [
      { type: "group", heading: "API keys", items: [
        row("Anthropic API key", "console.anthropic.com \u2192 API keys", (setting) => {
          setting.addText((t) => {
            t.inputEl.type = "password";
            t.setValue(s.anthropicApiKey).onChange(async (v) => {
              s.anthropicApiKey = v.trim();
              await save();
            });
          });
        }),
        row("OpenAI API key", "platform.openai.com \u2192 API keys", (setting) => {
          setting.addText((t) => {
            t.inputEl.type = "password";
            t.setValue(s.openaiApiKey).onChange(async (v) => {
              s.openaiApiKey = v.trim();
              await save();
            });
          });
        })
      ] },
      { type: "group", heading: "Model", items: [
        row("Provider", "", (setting) => {
          setting.addDropdown((d) => d.addOptions({ anthropic: "Claude", openai: "ChatGPT" }).setValue(s.provider).onChange(async (v) => {
            s.provider = v;
            await save();
          }));
        }),
        ...models,
        row("Effort level", "How hard the model thinks. OpenAI caps at high.", (setting) => {
          setting.addDropdown((d) => d.addOptions({ low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }).setValue(s.effort).onChange(async (v) => {
            s.effort = v;
            await save();
          }));
        }),
        row("Claude effort method", "Choose an effort parameter, thinking budget, or no extra reasoning.", (setting) => {
          setting.addDropdown((d) => d.addOptions({ effort: "Effort parameter", "thinking-budget": "Thinking budget", none: "Off" }).setValue(s.anthropicEffortMode).onChange(async (v) => {
            s.anthropicEffortMode = v;
            await save();
          }));
        }),
        row("Max output tokens", "", (setting) => {
          setting.addText((t) => t.setValue(String(s.maxOutputTokens)).onChange(async (v) => {
            const n = parseInt(v);
            if (n > 0) {
              s.maxOutputTokens = n;
              await save();
            }
          }));
        })
      ] },
      { type: "group", heading: "Scope", items: [
        row("Default scope", "Can be changed per chat in the chat panel.", (setting) => {
          setting.addDropdown((d) => d.addOptions({ file: "Current file", folder: "Current folder", vault: "Whole vault" }).setValue(s.defaultScope).onChange(async (v) => {
            s.defaultScope = v;
            await save();
          }));
        }),
        row("Folder scope includes subfolders", "", (setting) => {
          setting.addToggle((t) => t.setValue(s.includeSubfolders).onChange(async (v) => {
            s.includeSubfolders = v;
            await save();
          }));
        }),
        row("Max context characters", "Notes beyond this limit are dropped (active note always first).", (setting) => {
          setting.addText((t) => t.setValue(String(s.maxContextChars)).onChange(async (v) => {
            const n = parseInt(v);
            if (n > 0) {
              s.maxContextChars = n;
              await save();
            }
          }));
        })
      ] },
      { type: "group", heading: "File editing", items: [
        row("Let the AI modify notes", "Allow the assistant to create and edit notes. Turn off for a read-only chat.", (setting) => {
          setting.addToggle((t) => t.setValue(s.allowEdits).onChange(async (v) => {
            s.allowEdits = v;
            await save();
            this.refreshSettings();
          }));
        }),
        row("Require approval for changes", "Show a preview and wait for approval before writing. Turn off to apply changes immediately.", (setting) => {
          setting.addToggle((t) => t.setValue(s.requireApproval).onChange(async (v) => {
            s.requireApproval = v;
            await save();
          }));
        }, () => s.allowEdits),
        row("Max tool steps per request", "Safety cap on how many read/edit steps the AI can take before it must stop.", (setting) => {
          setting.addText((t) => t.setValue(String(s.maxToolRounds)).onChange(async (v) => {
            const n = parseInt(v);
            if (n > 0 && n <= 200) {
              s.maxToolRounds = n;
              await save();
            }
          }));
        }, () => s.allowEdits)
      ] },
      { type: "group", heading: "Conversation history", items: [
        row("Save-as-note folder", "Where exported conversations are saved in your vault.", (setting) => {
          setting.addText((t) => t.setPlaceholder("Conversation folder").setValue(s.notesFolder).onChange(async (v) => {
            s.notesFolder = v;
            await save();
          }));
        }),
        row("Saved conversations", `${this.plugin.history.all().length} chat(s) stored with the plugin. Search them with the history search button.`, (setting) => {
          let timer;
          let armed = false;
          setting.addButton((b) => {
            if ((0, import_obsidian6.requireApiVersion)("1.13.0")) b.setDestructive();
            else b.buttonEl.addClass("mod-warning");
            b.setButtonText("Delete all").onClick(async () => {
              if (!armed) {
                armed = true;
                b.setButtonText("Click again to confirm");
                timer = window.setTimeout(() => {
                  armed = false;
                  b.setButtonText("Delete all");
                }, 4e3);
                return;
              }
              if (timer !== void 0) window.clearTimeout(timer);
              await this.plugin.history.clear();
              new import_obsidian6.Notice("History cleared");
              this.refreshSettings();
            });
          });
          return () => {
            if (timer !== void 0) window.clearTimeout(timer);
          };
        }),
        row("System prompt", "", (setting) => {
          setting.addTextArea((t) => {
            t.inputEl.rows = 5;
            t.setValue(s.systemPrompt).onChange(async (v) => {
              s.systemPrompt = v;
              await save();
            });
          });
        })
      ] },
      { type: "group", heading: "Support", items: [
        row("Support development", "", (setting) => {
          const a = setting.controlEl.createEl("a", { text: "Buy me a coffee", href: DONATION_URL });
          a.setAttr("target", "_blank");
          a.setAttr("rel", "noopener");
        })
      ] }
    ];
  }
  /** Compatibility renderer for Obsidian versions before 1.13.0. */
  display() {
    this.renderLegacy();
  }
  refreshSettings() {
    if ((0, import_obsidian6.requireApiVersion)("1.13.0")) this.update();
    else this.renderLegacy();
  }
  renderLegacy() {
    this.cleanLegacy();
    this.containerEl.empty();
    for (const group of this.getSettingDefinitions()) {
      new import_obsidian6.Setting(this.containerEl).setName(group.heading).setHeading();
      for (const row of group.items) {
        if (row.visible && !row.visible()) continue;
        const setting = new import_obsidian6.Setting(this.containerEl).setName(row.name).setDesc(row.desc ?? "");
        const cleanup = row.render(setting);
        if (cleanup) this.legacyCleanups.push(cleanup);
      }
    }
  }
  cleanLegacy() {
    for (const cleanup of this.legacyCleanups.splice(0)) cleanup();
  }
  hide() {
    this.cleanLegacy();
    super.hide();
  }
};

// src/main.ts
var AIWriterAssistantPlugin = class extends import_obsidian7.Plugin {
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.history = new HistoryStore(this);
    await this.history.load();
    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-square", "Open chat panel", () => this.activateView());
    this.addCommand({ id: "open-chat", name: "Open chat panel", callback: () => this.activateView() });
    this.addCommand({ id: "search-history", name: "Search past conversations", callback: () => new SearchModal(this.app, this).open() });
    this.addSettingTab(new SettingsTab(this.app, this));
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  async openConversation(id) {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof ChatView) await view.loadConversation(id);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};

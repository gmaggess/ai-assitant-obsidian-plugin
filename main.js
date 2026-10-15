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
  default: () => ScopedAIChatPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/view.ts
var import_obsidian4 = require("obsidian");

// src/context.ts
async function buildContext(app, scope, includeSubfolders, maxChars) {
  const active = app.workspace.getActiveFile();
  let files = [];
  let label = "";
  if (scope === "file") {
    if (!active) throw new Error("No active file. Open a note to use File scope.");
    files = [active];
    label = `File: ${active.path}`;
  } else if (scope === "folder") {
    const folder = active?.parent ?? app.vault.getRoot();
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
var THINKING_BUDGET = { low: 2048, medium: 6e3, high: 16e3, xhigh: 24e3, max: 32e3 };
function errMsg(status, body) {
  const m = body?.error?.message ?? body?.message ?? JSON.stringify(body);
  return `API error ${status}: ${m}`;
}
async function sendChat(s, system, messages) {
  return s.provider === "anthropic" ? sendAnthropic(s, system, messages) : sendOpenAI(s, system, messages);
}
async function sendAnthropic(s, system, messages) {
  if (!s.anthropicApiKey) throw new Error("Add your Anthropic API key in plugin settings.");
  const body = { model: s.anthropicModel, max_tokens: s.maxOutputTokens, system, messages };
  if (s.anthropicEffortMode === "effort") {
    body.output_config = { effort: s.effort };
  } else if (s.anthropicEffortMode === "thinking-budget") {
    const budget = Math.min(THINKING_BUDGET[s.effort], Math.max(1024, s.maxOutputTokens - 1024));
    body.thinking = { type: "enabled", budget_tokens: budget };
    if (body.max_tokens <= budget) body.max_tokens = budget + 2048;
  }
  const res = await (0, import_obsidian.requestUrl)({
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
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  const data = res.json;
  if (data.stop_reason === "refusal") return "_The model declined to answer this request._";
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
async function sendOpenAI(s, system, messages) {
  if (!s.openaiApiKey) throw new Error("Add your OpenAI API key in plugin settings.");
  const effort = s.effort === "max" || s.effort === "xhigh" ? "high" : s.effort;
  const body = {
    model: s.openaiModel,
    instructions: system,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: s.maxOutputTokens,
    store: false,
    reasoning: { effort }
  };
  let res = await post(s, body);
  if (res.status === 400 && /reasoning/i.test(JSON.stringify(res.json))) {
    delete body.reasoning;
    res = await post(s, body);
  }
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  const data = res.json;
  if (data.output_text) return data.output_text;
  const out = [];
  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) if (c.type === "output_text") out.push(c.text);
    }
  }
  return out.join("\n") || "_(empty response \u2014 try raising Max output tokens)_";
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
    return (res2.json.data ?? []).map((m) => m.id);
  }
  const res = await (0, import_obsidian.requestUrl)({
    url: "https://api.openai.com/v1/models",
    throw: false,
    headers: { authorization: `Bearer ${s.openaiApiKey}` }
  });
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  return (res.json.data ?? []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search)/.test(id)).sort();
}

// src/history.ts
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
      if (await a.exists(this.path)) this.items = JSON.parse(await a.read(this.path));
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
  const raw = JSON.parse(m[0]);
  return {
    summary: String(raw.summary ?? ""),
    matches: (Array.isArray(raw.matches) ? raw.matches : []).filter((x) => valid.has(String(x?.id))).map((x) => ({ id: String(x.id), reason: String(x.reason ?? "") }))
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
    const input = row.createEl("input", { type: "text", attr: { placeholder: "e.g. what did I decide about the Q3 reading list?", style: "flex:1" } });
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
        out.createDiv({ cls: "sac-msg error", text: e?.message ?? String(e) });
        new import_obsidian2.Notice("Search failed");
      } finally {
        btn.disabled = false;
      }
    };
    btn.onclick = run;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
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

// src/view.ts
var VIEW_TYPE = "scoped-ai-chat-view";
var ChatView = class extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.busy = false;
    this.convId = null;
    this.convCreated = 0;
    this.chatScope = plugin.settings.defaultScope;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Scoped AI Chat";
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
    const s = this.plugin.settings;
    const bar = root.createDiv("sac-toolbar");
    const picker = bar.createEl("details", { cls: "sac-model-picker" });
    const trigger = picker.createEl("summary", { cls: "sac-model-trigger", attr: { "aria-label": "Provider, model, and effort" } });
    const selection = trigger.createSpan({ cls: "sac-model-selection" });
    const chevron = trigger.createSpan({ cls: "sac-model-chevron" });
    (0, import_obsidian4.setIcon)(chevron, "chevron-down");
    const menu = picker.createDiv({ cls: "sac-model-menu" });
    const field = (label) => {
      const row2 = menu.createEl("label", { cls: "sac-model-field" });
      row2.createSpan({ text: label });
      return row2.createEl("select", { attr: { "aria-label": label } });
    };
    const provider = field("Provider");
    [["anthropic", "Claude"], ["openai", "ChatGPT"]].forEach(([v, l]) => provider.createEl("option", { value: v, text: l }));
    provider.value = s.provider;
    const model = field("Model");
    const updateSelection = () => {
      const name = s.provider === "anthropic" ? "Claude" : "ChatGPT";
      const current = s.provider === "anthropic" ? s.anthropicModel : s.openaiModel;
      selection.setText(`${name} \xB7 ${current} \xB7 ${s.effort}`);
      (0, import_obsidian4.setTooltip)(trigger, `${name} \xB7 ${current} \xB7 Effort: ${s.effort}`);
    };
    const fillModels = () => {
      model.empty();
      const list = s.provider === "anthropic" ? s.anthropicModels : s.openaiModels;
      const current = s.provider === "anthropic" ? s.anthropicModel : s.openaiModel;
      const all = list.includes(current) ? list : [current, ...list];
      all.forEach((m) => model.createEl("option", { value: m, text: m }));
      model.value = current;
      updateSelection();
    };
    fillModels();
    const effort = field("Effort");
    ["low", "medium", "high", "xhigh", "max"].forEach((e) => effort.createEl("option", { value: e, text: e }));
    effort.value = s.effort;
    this.registerDomEvent(root.ownerDocument, "click", (event) => {
      if (event.target instanceof Node && !picker.contains(event.target)) picker.open = false;
    });
    this.registerDomEvent(picker, "keydown", (event) => {
      if (event.key === "Escape") {
        picker.open = false;
        trigger.focus();
      }
    });
    const scope = bar.createEl("select", { attr: { "aria-label": "Scope" } });
    [["file", "Scope: File"], ["folder", "Scope: Folder"], ["vault", "Scope: Vault"]].forEach(([v, l]) => scope.createEl("option", { value: v, text: l }));
    scope.value = this.chatScope;
    const actions = bar.createDiv("sac-actions");
    const action = (icon, label) => {
      const button = actions.createEl("button", { cls: "clickable-icon sac-icon-button", attr: { "aria-label": label, type: "button" } });
      (0, import_obsidian4.setIcon)(button, icon);
      (0, import_obsidian4.setTooltip)(button, label);
      return button;
    };
    const clear = action("square-pen", "New chat");
    const search = action("search", "Search history");
    search.onclick = () => new SearchModal(this.app, this.plugin).open();
    const saveNote = action("file-down", "Save as note");
    saveNote.onclick = () => this.saveAsNote();
    this.scopeSelect = scope;
    provider.onchange = async () => {
      s.provider = provider.value;
      fillModels();
      await this.plugin.saveSettings();
    };
    model.onchange = async () => {
      if (s.provider === "anthropic") s.anthropicModel = model.value;
      else s.openaiModel = model.value;
      updateSelection();
      await this.plugin.saveSettings();
    };
    effort.onchange = async () => {
      s.effort = effort.value;
      updateSelection();
      await this.plugin.saveSettings();
    };
    scope.onchange = () => {
      this.chatScope = scope.value;
      this.updateScopeInfo();
    };
    clear.onclick = () => {
      this.messages = [];
      this.convId = null;
      this.messagesEl.empty();
    };
    this.scopeInfoEl = root.createDiv("sac-scope-info");
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
    send.onclick = submit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
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
    this.scopeSelect.value = c.scope;
    this.updateScopeInfo();
    this.messagesEl.empty();
    this.messagesEl.createDiv({ cls: "sac-scope-info", text: `Resumed chat from ${new Date(c.updatedAt).toLocaleString()} (${c.scopeLabel})` });
    for (const m of c.messages) {
      const el = this.messagesEl.createDiv({ cls: `sac-msg ${m.role}` });
      if (m.role === "user") el.setText(m.content);
      else await import_obsidian4.MarkdownRenderer.render(this.app, m.content, el, "", this);
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
  async saveAsNote() {
    const c = this.convId ? this.plugin.history.get(this.convId) : void 0;
    if (!c || c.messages.length === 0) {
      new import_obsidian4.Notice("Nothing to save yet \u2014 send a message first.");
      return;
    }
    try {
      const file = await saveConversationNote(this.app, c, this.plugin.settings.notesFolder);
      new import_obsidian4.Notice(`Saved to ${file.path}`);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      new import_obsidian4.Notice(`Couldn't save note: ${e?.message ?? e}`);
    }
  }
  updateScopeInfo() {
    if (!this.scopeInfoEl) return;
    const active = this.app.workspace.getActiveFile();
    const t = this.chatScope === "file" ? active?.path ?? "no file open" : this.chatScope === "folder" ? active?.parent?.path ?? "/" : `${this.app.vault.getMarkdownFiles().length} notes`;
    this.scopeInfoEl.setText(`Context: ${this.chatScope} \u2014 ${t}`);
  }
  async ask(text, sendBtn) {
    this.busy = true;
    sendBtn.disabled = true;
    this.messages.push({ role: "user", content: text });
    this.messagesEl.createDiv({ cls: "sac-msg user", text });
    const pending = this.messagesEl.createDiv({ cls: "sac-msg assistant", text: "Thinking\u2026" });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    try {
      const s = this.plugin.settings;
      const ctx = await buildContext(this.app, this.chatScope, s.includeSubfolders, s.maxContextChars);
      if (ctx.truncated) new import_obsidian4.Notice("Context was truncated to fit Max context characters.");
      const system = `${s.systemPrompt}

Scope: ${ctx.label} (${ctx.files.length} note(s)${ctx.truncated ? ", truncated" : ""})

<context>
${ctx.text}</context>`;
      const reply = await sendChat(s, system, this.messages);
      this.messages.push({ role: "assistant", content: reply });
      if (!this.convId) {
        this.convId = newId();
        this.convCreated = Date.now();
      }
      const conv = {
        id: this.convId,
        title: this.messages[0].content.slice(0, 80),
        scope: this.chatScope,
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
      await import_obsidian4.MarkdownRenderer.render(this.app, reply, pending, "", this);
    } catch (e) {
      this.messages.pop();
      pending.addClass("error");
      pending.setText(e?.message ?? String(e));
    } finally {
      this.busy = false;
      sendBtn.disabled = false;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
};

// src/settings.ts
var import_obsidian5 = require("obsidian");

// src/donation.ts
var DONATION_URL = "https://account.venmo.com/u/gmaggess";

// src/settings.ts
var SettingsTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();
    const coffee = containerEl.createDiv({ attr: { style: "display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:12px;border-radius:8px;background:var(--background-secondary)" } });
    coffee.createSpan({ text: "Enjoying Scoped AI Chat? Support its development \u2014 opens Venmo in a new tab." });
    const a = coffee.createEl("a", { text: "\u2615 Buy me a coffee on Venmo", href: DONATION_URL, cls: "mod-cta" });
    a.setAttr("target", "_blank");
    a.setAttr("style", "padding:6px 12px;border-radius:6px;background:var(--interactive-accent);color:var(--text-on-accent);text-decoration:none;font-weight:600");
    containerEl.createEl("h3", { text: "API keys" });
    new import_obsidian5.Setting(containerEl).setName("Anthropic API key").setDesc("console.anthropic.com \u2192 API keys").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(s.anthropicApiKey).onChange(async (v) => {
        s.anthropicApiKey = v.trim();
        await save();
      });
    });
    new import_obsidian5.Setting(containerEl).setName("OpenAI API key").setDesc("platform.openai.com \u2192 API keys").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(s.openaiApiKey).onChange(async (v) => {
        s.openaiApiKey = v.trim();
        await save();
      });
    });
    containerEl.createEl("h3", { text: "Model" });
    new import_obsidian5.Setting(containerEl).setName("Default provider").addDropdown((d) => d.addOptions({ anthropic: "Claude", openai: "ChatGPT" }).setValue(s.provider).onChange(async (v) => {
      s.provider = v;
      await save();
    }));
    for (const p of ["anthropic", "openai"]) {
      const label = p === "anthropic" ? "Claude" : "ChatGPT";
      new import_obsidian5.Setting(containerEl).setName(`${label} model`).setDesc("Pick from the list, or type any model ID.").addDropdown((d) => {
        const list = p === "anthropic" ? s.anthropicModels : s.openaiModels;
        list.forEach((m) => d.addOption(m, m));
        d.setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel).onChange(async (v) => {
          if (p === "anthropic") s.anthropicModel = v;
          else s.openaiModel = v;
          await save();
          this.display();
        });
      }).addText((t) => t.setPlaceholder("custom model id").setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel).onChange(async (v) => {
        if (p === "anthropic") s.anthropicModel = v.trim();
        else s.openaiModel = v.trim();
        await save();
      })).addButton((b) => b.setButtonText("Refresh list").onClick(async () => {
        try {
          const models = await fetchModels(s, p);
          if (!models.length) throw new Error("No models returned");
          if (p === "anthropic") s.anthropicModels = models;
          else s.openaiModels = models;
          await save();
          new import_obsidian5.Notice(`Loaded ${models.length} ${label} models`);
          this.display();
        } catch (e) {
          new import_obsidian5.Notice(e.message ?? String(e));
        }
      }));
    }
    new import_obsidian5.Setting(containerEl).setName("Effort level").setDesc("How hard the model thinks. OpenAI caps at high.").addDropdown((d) => d.addOptions({ low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }).setValue(s.effort).onChange(async (v) => {
      s.effort = v;
      await save();
    }));
    new import_obsidian5.Setting(containerEl).setName("Claude effort method").setDesc("'Effort' uses the newer effort parameter; 'Thinking budget' uses extended thinking tokens (widest model support).").addDropdown((d) => d.addOptions({ effort: "Effort parameter", "thinking-budget": "Thinking budget", none: "Off" }).setValue(s.anthropicEffortMode).onChange(async (v) => {
      s.anthropicEffortMode = v;
      await save();
    }));
    new import_obsidian5.Setting(containerEl).setName("Max output tokens").addText((t) => t.setValue(String(s.maxOutputTokens)).onChange(async (v) => {
      const n = parseInt(v);
      if (n > 0) {
        s.maxOutputTokens = n;
        await save();
      }
    }));
    containerEl.createEl("h3", { text: "Scope" });
    new import_obsidian5.Setting(containerEl).setName("Default scope").setDesc("Can be changed per chat in the chat panel.").addDropdown((d) => d.addOptions({ file: "Current file", folder: "Current folder", vault: "Whole vault" }).setValue(s.defaultScope).onChange(async (v) => {
      s.defaultScope = v;
      await save();
    }));
    new import_obsidian5.Setting(containerEl).setName("Folder scope includes subfolders").addToggle((t) => t.setValue(s.includeSubfolders).onChange(async (v) => {
      s.includeSubfolders = v;
      await save();
    }));
    new import_obsidian5.Setting(containerEl).setName("Max context characters").setDesc("Notes beyond this limit are dropped (active note always first).").addText((t) => t.setValue(String(s.maxContextChars)).onChange(async (v) => {
      const n = parseInt(v);
      if (n > 0) {
        s.maxContextChars = n;
        await save();
      }
    }));
    containerEl.createEl("h3", { text: "Conversation history" });
    new import_obsidian5.Setting(containerEl).setName("Save-as-note folder").setDesc('Where "Save as note" puts conversations in your vault.').addText((t) => t.setPlaceholder("AI Chats").setValue(s.notesFolder).onChange(async (v) => {
      s.notesFolder = v;
      await save();
    }));
    new import_obsidian5.Setting(containerEl).setName("Saved conversations").setDesc(`${this.plugin.history.all().length} chat(s) stored privately with the plugin. Search them with the "Search history" button.`).addButton((b) => b.setButtonText("Delete all").setWarning().onClick(async () => {
      if (!confirm("Delete all saved conversations?")) return;
      await this.plugin.history.clear();
      new import_obsidian5.Notice("History cleared");
      this.display();
    }));
    new import_obsidian5.Setting(containerEl).setName("System prompt").addTextArea((t) => {
      t.inputEl.rows = 5;
      t.setValue(s.systemPrompt).onChange(async (v) => {
        s.systemPrompt = v;
        await save();
      });
    });
  }
};

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
  systemPrompt: "You are a helpful assistant inside the user's Obsidian vault. Answer ONLY using the notes provided in the context. If the answer is not in the provided notes, say so. Cite note paths when relevant."
};

// src/main.ts
var ScopedAIChatPlugin = class extends import_obsidian6.Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.history = new HistoryStore(this);
    await this.history.load();
    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-square", "Open Scoped AI Chat", () => this.activateView());
    this.addCommand({ id: "open-chat", name: "Open chat panel", callback: () => this.activateView() });
    this.addCommand({ id: "search-history", name: "Search past conversations", callback: () => new SearchModal(this.app, this).open() });
    this.addSettingTab(new SettingsTab(this.app, this));
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async openConversation(id) {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof ChatView) view.loadConversation(id);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};

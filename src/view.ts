import { ItemView, MarkdownRenderer, WorkspaceLeaf, Notice, setIcon, setTooltip } from "obsidian";
import type ScopedAIChatPlugin from "./main";
import { buildContext } from "./context";
import { sendChat } from "./providers";
import { newId, Conversation } from "./history";
import { SearchModal } from "./search";
import { saveConversationNote } from "./export";
import { ChatMessage, Effort, Provider, Scope } from "./types";

export const VIEW_TYPE = "scoped-ai-chat-view";

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private chatScope: Scope;
  private messagesEl!: HTMLElement;
  private scopeInfoEl!: HTMLElement;
  private busy = false;
  private convId: string | null = null;
  private convCreated = 0;
  private scopeSelect!: HTMLSelectElement;

  constructor(leaf: WorkspaceLeaf, private plugin: ScopedAIChatPlugin) {
    super(leaf);
    this.chatScope = plugin.settings.defaultScope;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Scoped AI Chat"; }
  getIcon() { return "message-square"; }

  async onOpen() { this.render(); this.registerEvent(this.app.workspace.on("file-open", () => this.updateScopeInfo())); }

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
    setIcon(chevron, "chevron-down");
    const menu = picker.createDiv({ cls: "sac-model-menu" });
    const field = (label: string) => {
      const row = menu.createEl("label", { cls: "sac-model-field" });
      row.createSpan({ text: label });
      return row.createEl("select", { attr: { "aria-label": label } });
    };
    const provider = field("Provider");
    [["anthropic", "Claude"], ["openai", "ChatGPT"]].forEach(([v, l]) => provider.createEl("option", { value: v, text: l }));
    provider.value = s.provider;

    const model = field("Model");
    const updateSelection = () => {
      const name = s.provider === "anthropic" ? "Claude" : "ChatGPT";
      const current = s.provider === "anthropic" ? s.anthropicModel : s.openaiModel;
      selection.setText(`${name} · ${current} · ${s.effort}`);
      setTooltip(trigger, `${name} · ${current} · Effort: ${s.effort}`);
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
    (["low", "medium", "high", "xhigh", "max"] as Effort[]).forEach((e) => effort.createEl("option", { value: e, text: e }));
    effort.value = s.effort;
    this.registerDomEvent(root.ownerDocument, "click", (event) => {
      if (event.target instanceof Node && !picker.contains(event.target)) picker.open = false;
    });
    this.registerDomEvent(picker, "keydown", (event) => {
      if (event.key === "Escape") { picker.open = false; trigger.focus(); }
    });

    const scope = bar.createEl("select", { attr: { "aria-label": "Scope" } });
    [["file", "Scope: File"], ["folder", "Scope: Folder"], ["vault", "Scope: Vault"]].forEach(([v, l]) => scope.createEl("option", { value: v, text: l }));
    scope.value = this.chatScope;

    const actions = bar.createDiv("sac-actions");
    const action = (icon: string, label: string) => {
      const button = actions.createEl("button", { cls: "clickable-icon sac-icon-button", attr: { "aria-label": label, type: "button" } });
      setIcon(button, icon);
      setTooltip(button, label);
      return button;
    };
    const clear = action("square-pen", "New chat");
    const search = action("search", "Search history");
    search.onclick = () => new SearchModal(this.app, this.plugin).open();
    const saveNote = action("file-down", "Save as note");
    saveNote.onclick = () => this.saveAsNote();
    this.scopeSelect = scope;

    provider.onchange = async () => { s.provider = provider.value as Provider; fillModels(); await this.plugin.saveSettings(); };
    model.onchange = async () => {
      if (s.provider === "anthropic") s.anthropicModel = model.value; else s.openaiModel = model.value;
      updateSelection();
      await this.plugin.saveSettings();
    };
    effort.onchange = async () => { s.effort = effort.value as Effort; updateSelection(); await this.plugin.saveSettings(); };
    scope.onchange = () => { this.chatScope = scope.value as Scope; this.updateScopeInfo(); };
    clear.onclick = () => { this.messages = []; this.convId = null; this.messagesEl.empty(); };

    this.scopeInfoEl = root.createDiv("sac-scope-info");
    this.updateScopeInfo();

    this.messagesEl = root.createDiv("sac-messages");

    const row = root.createDiv("sac-input-row");
    const input = row.createEl("textarea", { attr: { placeholder: "Ask about your notes… (Enter to send, Shift+Enter for newline)" } });
    const send = row.createEl("button", { text: "Send", cls: "mod-cta" });
    const submit = async () => {
      const text = input.value.trim();
      if (!text || this.busy) return;
      input.value = "";
      await this.ask(text, send);
    };
    send.onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  }

  async loadConversation(id: string) {
    const c = this.plugin.history.get(id);
    if (!c) return;
    this.convId = c.id; this.convCreated = c.createdAt;
    this.messages = [...c.messages];
    this.chatScope = c.scope; this.scopeSelect.value = c.scope; this.updateScopeInfo();
    this.messagesEl.empty();
    this.messagesEl.createDiv({ cls: "sac-scope-info", text: `Resumed chat from ${new Date(c.updatedAt).toLocaleString()} (${c.scopeLabel})` });
    for (const m of c.messages) {
      const el = this.messagesEl.createDiv({ cls: `sac-msg ${m.role}` });
      if (m.role === "user") el.setText(m.content); else await MarkdownRenderer.render(this.app, m.content, el, "", this);
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async saveAsNote() {
    const c = this.convId ? this.plugin.history.get(this.convId) : undefined;
    if (!c || c.messages.length === 0) { new Notice("Nothing to save yet — send a message first."); return; }
    try {
      const file = await saveConversationNote(this.app, c, this.plugin.settings.notesFolder);
      new Notice(`Saved to ${file.path}`);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e: any) { new Notice(`Couldn't save note: ${e?.message ?? e}`); }
  }

  private updateScopeInfo() {
    if (!this.scopeInfoEl) return;
    const active = this.app.workspace.getActiveFile();
    const t = this.chatScope === "file" ? (active?.path ?? "no file open")
      : this.chatScope === "folder" ? (active?.parent?.path ?? "/")
      : `${this.app.vault.getMarkdownFiles().length} notes`;
    this.scopeInfoEl.setText(`Context: ${this.chatScope} — ${t}`);
  }

  private async ask(text: string, sendBtn: HTMLButtonElement) {
    this.busy = true;
    sendBtn.disabled = true;
    this.messages.push({ role: "user", content: text });
    this.messagesEl.createDiv({ cls: "sac-msg user", text });
    const pending = this.messagesEl.createDiv({ cls: "sac-msg assistant", text: "Thinking…" });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    try {
      const s = this.plugin.settings;
      const ctx = await buildContext(this.app, this.chatScope, s.includeSubfolders, s.maxContextChars);
      if (ctx.truncated) new Notice("Context was truncated to fit Max context characters.");
      const system = `${s.systemPrompt}\n\nScope: ${ctx.label} (${ctx.files.length} note(s)${ctx.truncated ? ", truncated" : ""})\n\n<context>\n${ctx.text}</context>`;
      const reply = await sendChat(s, system, this.messages);
      this.messages.push({ role: "assistant", content: reply });
      if (!this.convId) { this.convId = newId(); this.convCreated = Date.now(); }
      const conv: Conversation = {
        id: this.convId, title: this.messages[0].content.slice(0, 80), scope: this.chatScope, scopeLabel: ctx.label,
        provider: s.provider, model: s.provider === "anthropic" ? s.anthropicModel : s.openaiModel,
        effort: s.effort,
        createdAt: this.convCreated, updatedAt: Date.now(), messages: [...this.messages],
      };
      await this.plugin.history.upsert(conv);
      pending.empty();
      await MarkdownRenderer.render(this.app, reply, pending, "", this);
    } catch (e: any) {
      this.messages.pop();
      pending.addClass("error");
      pending.setText(e?.message ?? String(e));
    } finally {
      this.busy = false;
      sendBtn.disabled = false;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
}

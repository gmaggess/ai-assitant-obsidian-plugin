import { App, FuzzySuggestModal, ItemView, MarkdownRenderer, Menu, TFolder, WorkspaceLeaf, Notice, setIcon, setTooltip } from "obsidian";
import type AIWriterAssistantPlugin from "./main";
import { buildContext } from "./context";
import { sendChat } from "./providers";
import { newId, Conversation } from "./history";
import { SearchModal } from "./search";
import { saveConversationNote } from "./export";
import { ChatMessage, Scope, editModeOf } from "./types";
import { ChangeRequest, EDIT_INSTRUCTIONS, VaultTools } from "./tools";
import { errorMessage } from "./data";

export const VIEW_TYPE = "ai-writer-assistant-view";

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private onPick: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder("Choose a folder for context…");
  }
  getItems() { return this.app.vault.getAllFolders(true); }
  getItemText(f: TFolder) { return f.isRoot() ? "/" : f.path; }
  onChooseItem(f: TFolder) { this.onPick(f); }
}

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private chatScope: Scope;
  private messagesEl!: HTMLElement;
  private busy = false;
  private cancel: (() => void) | null = null;
  private declinePending: (() => void) | null = null;
  private convId: string | null = null;
  private convCreated = 0;
  private chatFolder: string | undefined;
  private scopeButton!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, private plugin: AIWriterAssistantPlugin) {
    super(leaf);
    this.chatScope = plugin.settings.defaultScope;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.plugin.manifest.name; }
  getIcon() { return "message-square"; }

  async onOpen() { this.render(); this.registerEvent(this.app.workspace.on("file-open", () => this.updateScopeInfo())); }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("sac-view");
    const bar = root.createDiv("sac-toolbar");
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
    this.scopeButton = action("scan-search", "Scope");
    this.scopeButton.onclick = (e) => this.showScopeMenu(e);
    clear.onclick = () => { this.messages = []; this.convId = null; this.messagesEl.empty(); };

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
    send.onclick = () => { if (this.busy) this.cancel?.(); else void submit(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } });
  }

  async loadConversation(id: string) {
    const c = this.plugin.history.get(id);
    if (!c) return;
    this.convId = c.id; this.convCreated = c.createdAt;
    this.messages = [...c.messages];
    this.chatScope = c.scope; this.chatFolder = c.scope === "folder" ? c.folderPath : undefined; this.updateScopeInfo();
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
    } catch (e) { new Notice(`Couldn't save note: ${errorMessage(e)}`); }
  }

  private askApproval(c: ChangeRequest, before: HTMLElement): Promise<boolean> {
    return new Promise((resolve) => {
      const card = this.messagesEl.createDiv("sac-change");
      this.messagesEl.insertBefore(card, before);
      const verb = c.kind === "create" ? "Create" : c.kind === "append" ? "Append to" : "Edit";
      card.createDiv({ cls: "sac-change-title", text: `${verb} ${c.path}` });
      const diff = card.createEl("pre", { cls: "sac-diff" });
      const clip = (t: string) => (t.length > 1500 ? t.slice(0, 1500) + "\n…" : t);
      if (c.kind === "edit") {
        diff.createDiv({ cls: "sac-diff-del", text: clip(c.oldText) });
        diff.createDiv({ cls: "sac-diff-add", text: clip(c.newText) });
      } else diff.createDiv({ cls: "sac-diff-add", text: clip(c.content) });
      const row = card.createDiv("sac-change-actions");
      const apply = row.createEl("button", { text: "Apply", cls: "mod-cta" });
      const reject = row.createEl("button", { text: "Reject" });
      const done = (ok: boolean) => {
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

  private showScopeMenu(e: MouseEvent) {
    const menu = new Menu();
    const choose = (scope: Scope, title: string, icon: string, onPick: () => void) =>
      menu.addItem((i) => i.setTitle(title).setIcon(icon).setChecked(this.chatScope === scope).onClick(onPick));
    choose("file", "File", "file", () => { this.chatScope = "file"; this.updateScopeInfo(); });
    choose("folder", "Active note's folder", "folder", () => { this.chatScope = "folder"; this.chatFolder = undefined; this.updateScopeInfo(); });
    menu.addItem((i) => i.setTitle("Choose folder…").setIcon("folder-search").onClick(() =>
      new FolderPickerModal(this.app, (f) => { this.chatScope = "folder"; this.chatFolder = f.path; this.updateScopeInfo(); }).open()));
    choose("vault", "Vault", "vault", () => { this.chatScope = "vault"; this.updateScopeInfo(); });
    menu.showAtMouseEvent(e);
  }

  private updateScopeInfo() {
    if (!this.scopeButton) return;
    const active = this.app.workspace.getActiveFile();
    const t = this.chatScope === "file" ? (active?.path ?? "no file open")
      : this.chatScope === "folder" ? (this.chatFolder ?? active?.parent?.path ?? "/")
      : `${this.app.vault.getMarkdownFiles().length} notes`;
    this.scopeButton.toggleClass("is-active", this.chatScope !== "file");
    setTooltip(this.scopeButton, `Context: ${this.chatScope} — ${t}`);
  }

  private async ask(text: string, sendBtn: HTMLButtonElement) {
    this.busy = true;
    sendBtn.setText("Stop");
    sendBtn.removeClass("mod-cta");
    sendBtn.addClass("mod-warning");
    let stopped = false;
    const stopPromise = new Promise<never>((_, reject) => {
      this.cancel = () => { stopped = true; this.declinePending?.(); reject(new Error("Stopped")); };
    });
    stopPromise.catch(() => {});
    this.messages.push({ role: "user", content: text });
    this.messagesEl.createDiv({ cls: "sac-msg user", text });
    const pending = this.messagesEl.createDiv({ cls: "sac-msg assistant", text: "Thinking…" });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    try {
      const s = this.plugin.settings;
      const ctx = await buildContext(this.app, this.chatScope, s.includeSubfolders, s.maxContextChars, this.chatScope === "folder" ? this.chatFolder : undefined);
      if (ctx.truncated) new Notice("Context was truncated to fit max context characters.");
      const tools = editModeOf(s) === "off" ? undefined : new VaultTools(this.app, () => editModeOf(this.plugin.settings), (c) => this.askApproval(c, pending));
      const system = `${s.systemPrompt}${tools ? EDIT_INSTRUCTIONS : ""}\n\nScope: ${ctx.label} (${ctx.files.length} note(s)${ctx.truncated ? ", truncated" : ""})\n\n<context>\n${ctx.text}</context>`;
      let reply = await Promise.race([sendChat(s, system, this.messages, tools), stopPromise]);
      if (tools && tools.modified.size) reply += `\n\n---\n_Modified: ${[...tools.modified].map((p) => `[[${p}]]`).join(", ")}_`;
      this.messages.push({ role: "assistant", content: reply });
      if (!this.convId) { this.convId = newId(); this.convCreated = Date.now(); }
      const conv: Conversation = {
        id: this.convId, title: this.messages[0].content.slice(0, 80), scope: this.chatScope, folderPath: this.chatScope === "folder" ? this.chatFolder : undefined, scopeLabel: ctx.label,
        provider: s.provider, model: s.provider === "anthropic" ? s.anthropicModel : s.openaiModel,
        effort: s.effort,
        createdAt: this.convCreated, updatedAt: Date.now(), messages: [...this.messages],
      };
      await this.plugin.history.upsert(conv);
      pending.empty();
      await MarkdownRenderer.render(this.app, reply, pending, "", this);
    } catch (e) {
      this.messages.pop();
      if (stopped) { pending.setText("Stopped."); pending.addClass("sac-scope-info"); }
      else { pending.addClass("error"); pending.setText(errorMessage(e)); }
    } finally {
      this.busy = false;
      this.cancel = null;
      sendBtn.setText("Send");
      sendBtn.removeClass("mod-warning");
      sendBtn.addClass("mod-cta");
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
}

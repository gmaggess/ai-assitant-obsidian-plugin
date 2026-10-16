import { App, MarkdownRenderer, Modal, Notice, Component } from "obsidian";
import type AIWriterAssistantPlugin from "./main";
import { Conversation } from "./history";
import { sendChat } from "./providers";

interface SearchResult { summary: string; matches: { id: string; reason: string }[]; }

const PER_CHAT_CHARS = 2500;
const MAX_CANDIDATES = 200;

function digest(c: Conversation): string {
  let body = c.messages.map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`).join("\n");
  if (body.length > PER_CHAT_CHARS) body = body.slice(0, PER_CHAT_CHARS) + " …";
  return `<chat id="${c.id}" date="${new Date(c.updatedAt).toISOString().slice(0, 10)}" scope="${c.scopeLabel}">\n${body}\n</chat>`;
}

function parseResult(text: string, valid: Set<string>): SearchResult {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The model didn't return a readable result. Try again.");
  const raw = JSON.parse(m[0]);
  return {
    summary: String(raw.summary ?? ""),
    matches: (Array.isArray(raw.matches) ? raw.matches : [])
      .filter((x: any) => valid.has(String(x?.id)))
      .map((x: any) => ({ id: String(x.id), reason: String(x.reason ?? "") })),
  };
}

export async function searchHistory(plugin: AIWriterAssistantPlugin, query: string): Promise<SearchResult> {
  const chats = plugin.history.all().slice(0, MAX_CANDIDATES);
  if (!chats.length) return { summary: "You don't have any saved conversations yet.", matches: [] };
  const system =
    "You search a user's past AI conversations about their Obsidian notes. " +
    "Given a natural-language query and a list of chats, pick the chats that are genuinely relevant (best first, max 8) " +
    "and write a concise markdown summary of what those chats concluded about the query, mentioning dates or note paths when useful. " +
    'Reply with ONLY a JSON object: {"summary": string, "matches": [{"id": string, "reason": string}]}. ' +
    'If nothing is relevant, return {"summary": "No relevant conversations found.", "matches": []}.';
  const user = `Query: ${query}\n\n${chats.map(digest).join("\n\n")}`;
  const settings = { ...plugin.settings, anthropicEffortMode: "none" as const, effort: "low" as const };
  const text = await sendChat(settings, system, [{ role: "user", content: user }]);
  return parseResult(text, new Set(chats.map((c) => c.id)));
}

export class SearchModal extends Modal {
  private comp = new Component();
  constructor(app: App, private plugin: AIWriterAssistantPlugin) { super(app); }

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
      out.createDiv({ text: "Searching…", cls: "sac-scope-info" });
      try {
        const res = await searchHistory(this.plugin, q);
        out.empty();
        const sum = out.createDiv("sac-msg assistant");
        await MarkdownRenderer.render(this.app, res.summary || "_No summary._", sum, "", this.comp);
        for (const m of res.matches) {
          const c = this.plugin.history.get(m.id)!;
          const card = out.createDiv("sac-result");
          card.createDiv({ cls: "sac-result-title", text: c.title });
          card.createDiv({ cls: "sac-scope-info", text: `${new Date(c.updatedAt).toLocaleString()} · ${c.scopeLabel} · ${c.model}` });
          card.createDiv({ text: m.reason });
          card.onclick = async () => { this.close(); await this.plugin.openConversation(c.id); };
        }
      } catch (e: any) {
        out.empty();
        out.createDiv({ cls: "sac-msg error", text: e?.message ?? String(e) });
        new Notice("Search failed");
      } finally { btn.disabled = false; }
    };
    btn.onclick = run;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    input.focus();
  }
  onClose() { this.comp.unload(); this.contentEl.empty(); }
}

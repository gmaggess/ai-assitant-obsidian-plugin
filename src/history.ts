import type AIWriterAssistantPlugin from "./main";
import { ChatMessage, Scope } from "./types";
import { arrayOf, isRecord, parseJson } from "./data";

export interface Conversation {
  id: string;
  title: string;
  scope: Scope;
  folderPath?: string;
  scopeLabel: string;
  provider: string;
  model: string;
  effort?: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

function isConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false;
  return [value.id, value.title, value.scopeLabel, value.provider, value.model].every((v) => typeof v === "string")
    && (value.scope === "file" || value.scope === "folder" || value.scope === "vault")
    && typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
    && (value.folderPath === undefined || typeof value.folderPath === "string")
    && (value.effort === undefined || typeof value.effort === "string")
    && Array.isArray(value.messages) && arrayOf(value.messages).every((m) => isRecord(m)
      && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
}

export class HistoryStore {
  private items: Conversation[] = [];
  constructor(private plugin: AIWriterAssistantPlugin) {}

  private get path() { return `${this.plugin.manifest.dir}/history.json`; }

  async load() {
    const a = this.plugin.app.vault.adapter;
    try { if (await a.exists(this.path)) this.items = arrayOf(parseJson(await a.read(this.path))).filter(isConversation); } catch { this.items = []; }
  }
  private async persist() { await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(this.items)); }

  all() { return [...this.items].sort((a, b) => b.updatedAt - a.updatedAt); }
  get(id: string) { return this.items.find((c) => c.id === id); }

  async upsert(c: Conversation) {
    const i = this.items.findIndex((x) => x.id === c.id);
    if (i >= 0) this.items[i] = c; else this.items.push(c);
    await this.persist();
  }
  async remove(id: string) { this.items = this.items.filter((c) => c.id !== id); await this.persist(); }
  async clear() { this.items = []; await this.persist(); }
}

export function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

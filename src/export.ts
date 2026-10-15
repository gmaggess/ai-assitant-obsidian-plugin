import { App, normalizePath, TFile } from "obsidian";
import type { Conversation } from "./history";

const providerName = (p: string) => (p === "anthropic" ? "Claude" : p === "openai" ? "ChatGPT" : p);
const yaml = (v: string) => JSON.stringify(v);

export function conversationToMarkdown(c: Conversation): string {
  const fm = [
    "---",
    `title: ${yaml(c.title)}`,
    `provider: ${yaml(providerName(c.provider))}`,
    `model: ${yaml(c.model)}`,
    ...(c.effort ? [`effort: ${yaml(c.effort)}`] : []),
    `scope: ${yaml(c.scope)}`,
    `scope_target: ${yaml(c.scopeLabel)}`,
    `created: ${new Date(c.createdAt).toISOString()}`,
    `updated: ${new Date(c.updatedAt).toISOString()}`,
    `messages: ${c.messages.length}`,
    "tags: [ai-chat]",
    "---",
  ].join("\n");
  const details = [
    `> [!info] Conversation details`,
    `> **Model:** ${providerName(c.provider)} · \`${c.model}\`${c.effort ? ` · effort ${c.effort}` : ""}`,
    `> **Scope:** ${c.scope} — ${c.scopeLabel}`,
    `> **Date:** ${new Date(c.createdAt).toLocaleString()}`,
  ].join("\n");
  const body = c.messages
    .map((m) => `## ${m.role === "user" ? "🧑 You" : `🤖 ${providerName(c.provider)}`}\n\n${m.content.trim()}`)
    .join("\n\n");
  return `${fm}\n\n# ${c.title}\n\n${details}\n\n${body}\n`;
}

export async function saveConversationNote(app: App, c: Conversation, folder: string): Promise<TFile> {
  const dir = normalizePath(folder.trim() || "AI Chats");
  if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
  const d = new Date(c.createdAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const safe = c.title.replace(/[\\/:*?"<>|#^[\]\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Chat";
  let path = normalizePath(`${dir}/${stamp} ${safe}.md`);
  for (let i = 2; app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${dir}/${stamp} ${safe} (${i}).md`);
  return app.vault.create(path, conversationToMarkdown(c));
}

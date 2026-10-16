import { App, TFile, normalizePath } from "obsidian";
import { EditMode, ToolDef, ToolHost } from "./types";

export type ChangeRequest =
  | { kind: "create"; path: string; content: string }
  | { kind: "append"; path: string; content: string }
  | { kind: "edit"; path: string; oldText: string; newText: string };

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "read_note",
    description: "Read the full current contents of a note in the vault.",
    schema: { type: "object", properties: { path: { type: "string", description: "Vault-relative path, e.g. Projects/Plan.md" } }, required: ["path"] },
  },
  {
    name: "edit_note",
    description: "Replace one exact passage in an existing note. old_text must match the note exactly and occur once; include enough surrounding text to be unique.",
    schema: {
      type: "object",
      properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "append_to_note",
    description: "Add text to the end of an existing note.",
    schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  },
  {
    name: "create_note",
    description: "Create a new note (and any missing folders). Fails if the note already exists.",
    schema: { type: "object", properties: { path: { type: "string", description: "Vault-relative path ending in .md" }, content: { type: "string" } }, required: ["path", "content"] },
  },
];

export const EDIT_INSTRUCTIONS =
  "\n\nYou can read and modify notes in the vault with the provided tools. Only change notes when the user asks you to. " +
  "Prefer edit_note with a small, unique old_text over rewriting whole notes. Paths are vault-relative. " +
  "If the user declines a change, do not retry it; acknowledge it and move on.";

/** Pure helper: replace the single occurrence of oldText. */
export function applyEdit(content: string, oldText: string, newText: string): { ok: true; content: string } | { ok: false; error: string } {
  if (!oldText) return { ok: false, error: "old_text is empty." };
  const first = content.indexOf(oldText);
  if (first === -1) return { ok: false, error: "old_text was not found in the note. Read the note again and copy the passage exactly." };
  if (content.indexOf(oldText, first + oldText.length) !== -1) return { ok: false, error: "old_text occurs more than once. Include more surrounding text to make it unique." };
  return { ok: true, content: content.slice(0, first) + newText + content.slice(first + oldText.length) };
}

/** Returns an error string if the path is unsafe, otherwise null. */
export function checkPath(path: unknown, configDir: string): string | null {
  if (typeof path !== "string" || !path.trim()) return "path is required.";
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "path must be vault-relative.";
  const parts = path.split(/[\\/]/);
  if (parts.includes("..")) return "path must not contain '..'.";
  if (parts[0] === configDir) return "the vault configuration folder is off limits.";
  return null;
}

export class VaultTools implements ToolHost {
  defs = TOOL_DEFS;
  modified = new Set<string>();

  constructor(private app: App, private mode: () => EditMode, private confirm: (c: ChangeRequest) => Promise<boolean>) {}

  async run(name: string, input: any): Promise<string> {
    const bad = checkPath(input?.path, this.app.vault.configDir);
    if (bad) return `Error: ${bad}`;
    const path = normalizePath(input.path);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (name === "read_note") {
      if (!(existing instanceof TFile)) return `Error: no note at ${path}.`;
      return await this.app.vault.read(existing);
    }
    if (this.mode() === "off") return "Error: file editing is disabled in settings.";

    if (name === "create_note") {
      if (existing) return `Error: ${path} already exists. Use edit_note or append_to_note.`;
      const content = String(input.content ?? "");
      if (!(await this.approve({ kind: "create", path, content }))) return "The user declined this change.";
      const slash = path.lastIndexOf("/");
      if (slash > 0) await this.ensureFolder(path.slice(0, slash));
      await this.app.vault.create(path, content);
      this.modified.add(path);
      return `Created ${path}.`;
    }
    if (name === "edit_note" || name === "append_to_note") {
      if (!(existing instanceof TFile)) return `Error: no note at ${path}.`;
      const current = await this.app.vault.read(existing);
      let next: string;
      let req: ChangeRequest;
      if (name === "edit_note") {
        const r = applyEdit(current, String(input.old_text ?? ""), String(input.new_text ?? ""));
        if (!r.ok) return `Error: ${r.error}`;
        next = r.content;
        req = { kind: "edit", path, oldText: String(input.old_text), newText: String(input.new_text ?? "") };
      } else {
        const add = String(input.content ?? "");
        next = current + (current.endsWith("\n") || !current ? "" : "\n") + add;
        req = { kind: "append", path, content: add };
      }
      if (!(await this.approve(req))) return "The user declined this change.";
      await this.app.vault.modify(existing, next);
      this.modified.add(path);
      return `Updated ${path}.`;
    }
    return `Error: unknown tool ${name}.`;
  }

  private async approve(c: ChangeRequest): Promise<boolean> {
    return this.mode() === "auto" ? true : this.confirm(c);
  }

  private async ensureFolder(folder: string) {
    let acc = "";
    for (const part of folder.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(acc)) await this.app.vault.createFolder(acc);
    }
  }
}

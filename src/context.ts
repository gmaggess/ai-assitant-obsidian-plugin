import { App, TFile, TFolder } from "obsidian";
import { Scope } from "./types";

export interface ScopeContext { label: string; files: TFile[]; text: string; truncated: boolean; }

export async function buildContext(app: App, scope: Scope, includeSubfolders: boolean, maxChars: number): Promise<ScopeContext> {
  const active = app.workspace.getActiveFile();
  let files: TFile[] = [];
  let label = "";

  if (scope === "file") {
    if (!active) throw new Error("No active file. Open a note to use File scope.");
    files = [active];
    label = `File: ${active.path}`;
  } else if (scope === "folder") {
    const folder: TFolder | null = active?.parent ?? app.vault.getRoot();
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

  // Active file first so it survives truncation
  if (active) files.sort((a, b) => (a === active ? -1 : b === active ? 1 : a.path.localeCompare(b.path)));

  let text = "";
  let truncated = false;
  for (const f of files) {
    const body = await app.vault.cachedRead(f);
    const chunk = `<note path="${f.path}">\n${body}\n</note>\n\n`;
    if (text.length + chunk.length > maxChars) {
      const remaining = maxChars - text.length;
      if (remaining > 500) text += chunk.slice(0, remaining) + "\n…[truncated]</note>\n";
      truncated = true;
      break;
    }
    text += chunk;
  }
  return { label, files, text, truncated };
}

import { describe, it, expect, beforeEach } from "vitest";
import { buildContext } from "../src/context";
import { mockRequestUrl, resetRequestUrlCalls, getRequestUrlCalls } from "./mocks/obsidian";

function fakeApp(opts: {
  activePath?: string;
  files: { path: string; parentPath: string; body?: string }[];
}) {
  const byPath = new Map(opts.files.map((f) => [f.path, f.body ?? `content of ${f.path}`]));
  // Each vault file gets a parent folder object, like real Obsidian TFiles do.
  const vaultFiles = opts.files.map((f) => ({
    path: f.path,
    parent: { path: f.parentPath },
  }));
  const active = opts.activePath ? vaultFiles.find((f) => f.path === opts.activePath) ?? null : null;
  return {
    workspace: { getActiveFile: () => active },
    vault: {
      getRoot: () => ({ path: "/" }),
      getMarkdownFiles: () => vaultFiles,
      cachedRead: async (f: any) => byPath.get(f.path)!,
    },
  } as any;
}

describe("buildContext", () => {
  beforeEach(() => resetRequestUrlCalls());

  it("file scope throws when no note is open", async () => {
    const app = fakeApp({ files: [] });
    await expect(buildContext(app, "file", false, 10000)).rejects.toThrow(/No active file/);
  });

  it("file scope uses only the active note and labels it", async () => {
    const app = fakeApp({
      activePath: "notes/todo.md",
      files: [
        { path: "notes/todo.md", parentPath: "notes" },
        { path: "other.md", parentPath: "/" },
      ],
    });
    const ctx = await buildContext(app, "file", false, 10000);
    expect(ctx.label).toBe("File: notes/todo.md");
    expect(ctx.files).toHaveLength(1);
    expect(ctx.text).toContain("<note path=\"notes/todo.md\">");
    expect(ctx.text).not.toContain("other.md");
    expect(ctx.truncated).toBe(false);
  });

  it("folder scope without subfolders includes only direct children", async () => {
    const app = fakeApp({
      activePath: "notes/a.md",
      files: [
        { path: "notes/a.md", parentPath: "notes" },
        { path: "notes/b.md", parentPath: "notes" },
        { path: "notes/sub/c.md", parentPath: "notes/sub" },
        { path: "root.md", parentPath: "/" },
      ],
    });
    const ctx = await buildContext(app, "folder", false, 10000);
    expect(ctx.label).toBe("Folder: notes");
    expect(ctx.files.map((f: any) => f.path).sort()).toEqual(["notes/a.md", "notes/b.md"]);
  });

  it("folder scope with subfolders includes nested notes", async () => {
    const app = fakeApp({
      activePath: "notes/a.md",
      files: [
        { path: "notes/a.md", parentPath: "notes" },
        { path: "notes/sub/c.md", parentPath: "notes/sub" },
        { path: "root.md", parentPath: "/" },
      ],
    });
    const ctx = await buildContext(app, "folder", true, 10000);
    expect(ctx.label).toContain("(+subfolders)");
    expect(ctx.files.map((f: any) => f.path).sort()).toEqual(["notes/a.md", "notes/sub/c.md"]);
  });

  it("vault scope includes every note", async () => {
    const app = fakeApp({
      files: [
        { path: "a.md", parentPath: "/" },
        { path: "b/deep.md", parentPath: "b" },
      ],
    });
    const ctx = await buildContext(app, "vault", false, 10000);
    expect(ctx.label).toBe("Vault");
    expect(ctx.files).toHaveLength(2);
  });

  it("puts the active file first in the text", async () => {
    const app = fakeApp({
      activePath: "z-active.md",
      files: [
        { path: "a.md", parentPath: "/" },
        { path: "z-active.md", parentPath: "/" },
      ],
    });
    const ctx = await buildContext(app, "vault", false, 10000);
    const aPos = ctx.text.indexOf("<note path=\"a.md\">");
    const zPos = ctx.text.indexOf("<note path=\"z-active.md\">");
    expect(aPos).toBeGreaterThan(-1);
    expect(zPos).toBeLessThan(aPos);
  });

  it("truncates at the char limit and marks it", async () => {
    const app = fakeApp({
      files: [
        { path: "big.md", parentPath: "/", body: "x".repeat(4000) },
        { path: "small.md", parentPath: "/" },
      ],
    });
    const ctx = await buildContext(app, "vault", false, 1000);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBeLessThanOrEqual(1100); // limit + closing tag
    expect(ctx.text).toContain("…[truncated]</note>");
    expect(ctx.text).not.toContain("small.md");
  });
});

describe("search digest + parse", () => {
  const settings = { provider: "anthropic", anthropicApiKey: "sk-test", maxOutputTokens: 8000, anthropicEffortMode: "none", effort: "low" };

  beforeEach(() => resetRequestUrlCalls());

  it("searchHistory returns an early result with no saved chats and calls no API", async () => {
    const { searchHistory } = await import("../src/search");
    const plugin = { settings, history: { all: () => [] } } as any;
    const res = await searchHistory(plugin, "anything");
    expect(res.matches).toEqual([]);
    expect(res.summary).toMatch(/saved conversations/i);
    expect(getRequestUrlCalls()).toHaveLength(0);
  });

  it("searchHistory sends a digest prompt, filters invalid ids and returns matches", async () => {
    const { searchHistory } = await import("../src/search");
    const chats = [
      { id: "keep1", title: "Reading list", scope: "vault", scopeLabel: "Vault", provider: "anthropic", model: "claude-x", createdAt: 1, updatedAt: Date.now(), messages: [{ role: "user", content: "Q3 books?" }] },
      { id: "keep2", title: "Other", scope: "file", scopeLabel: "File: a.md", provider: "openai", model: "gpt-5", createdAt: 1, updatedAt: Date.now(), messages: [{ role: "user", content: "unrelated" }, { role: "assistant", content: "ok" }] },
    ];
    mockRequestUrl(async () => ({
      status: 200,
      json: {
        content: [
          {
            type: "text",
            text: 'Here you go: {"summary": "You asked about Q3 reading.", "matches": [{"id": "keep1", "reason": "direct hit"}, {"id": "deleted-chat", "reason": "should be dropped"}, {"id": 123, "reason": "bad type"}]}',
          },
        ],
      },
      text: "",
    }));
    const plugin = { settings, history: { all: () => chats } } as any;
    const res = await searchHistory(plugin, "what was my q3 reading list?");
    expect(res.summary).toContain("Q3 reading");
    expect(res.matches).toEqual([{ id: "keep1", reason: "direct hit" }]);
    const call = getRequestUrlCalls()[0];
    const body = JSON.parse(call.body!);
    expect(body.messages[0].content).toContain("what was my q3 reading list?");
    expect(body.messages[0].content).toContain("keep1");
  });

  it("searchHistory fails with a friendly message when the model returns no JSON", async () => {
    const { searchHistory } = await import("../src/search");
    const chats = [{ id: "a", title: "t", scope: "vault", scopeLabel: "Vault", provider: "anthropic", model: "m", createdAt: 1, updatedAt: 2, messages: [] }];
    mockRequestUrl(async () => ({ status: 200, json: { content: [{ type: "text", text: "no json here" }] }, text: "" }));
    await expect(
      searchHistory({ settings, history: { all: () => chats } } as any, "q")
    ).rejects.toThrow(/didn't return a readable result/);
  });
});

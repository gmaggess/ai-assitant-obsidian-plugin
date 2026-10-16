import { describe, it, expect, beforeEach } from "vitest";
import { HistoryStore, newId, Conversation } from "../src/history";
import { ChatMessage } from "../src/types";

// HistoryStore only touches plugin.manifest.dir and plugin.app.vault.adapter.
function fakePlugin() {
  const files = new Map<string, string>();
  return {
    manifest: { dir: "/plugins/ai-writer-assistant" },
    app: {
      vault: {
        adapter: {
          exists: async (p: string) => files.has(p),
          read: async (p: string) => files.get(p)!,
          write: async (p: string, data: string) => void files.set(p, data),
        },
      },
    },
    _files: files,
  } as any;
}

function convo(id: string, updatedAt: number, messages: ChatMessage[] = []): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    scope: "vault",
    scopeLabel: "Vault",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    createdAt: updatedAt - 1000,
    updatedAt,
    messages,
  };
}

describe("HistoryStore", () => {
  it("starts empty and round-trips conversations through history.json", async () => {
    const plugin = fakePlugin();
    const store = new HistoryStore(plugin);
    await store.load();
    expect(store.all()).toEqual([]);

    const c = convo("a", 100, [{ role: "user", content: "hi" }]);
    await store.upsert(c);
    expect(store.get("a")).toEqual(c);

    // Reload from disk — persistence must survive a plugin restart.
    const store2 = new HistoryStore(plugin);
    await store2.load();
    expect(store2.get("a")?.messages[0].content).toBe("hi");
  });

  it("upserts by id and sorts newest first", async () => {
    const store = new HistoryStore(fakePlugin());
    await store.upsert(convo("old", 100));
    await store.upsert(convo("new", 200));
    expect(store.all().map((c) => c.id)).toEqual(["new", "old"]);

    const edited = convo("old", 300);
    await store.upsert(edited);
    expect(store.all().map((c) => c.id)).toEqual(["old", "new"]);
    expect(store.all()).toHaveLength(2);
  });

  it("removes and clears", async () => {
    const store = new HistoryStore(fakePlugin());
    await store.upsert(convo("a", 1));
    await store.upsert(convo("b", 2));
    await store.remove("a");
    expect(store.get("a")).toBeUndefined();
    expect(store.all()).toHaveLength(1);
    await store.clear();
    expect(store.all()).toHaveLength(0);
    expect(store.get("b")).toBeUndefined();
  });

  it("survives a corrupted history file", async () => {
    const plugin = fakePlugin();
    plugin._files.set("/plugins/ai-writer-assistant/history.json", "{not json");
    const store = new HistoryStore(plugin);
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.all()).toEqual([]);
  });

  it("keeps valid conversations and ignores invalid persisted entries", async () => {
    const plugin = fakePlugin();
    plugin._files.set("/plugins/ai-writer-assistant/history.json", JSON.stringify([null, { id: "bad" }, convo("valid", 100)]));
    const store = new HistoryStore(plugin);
    await store.load();
    expect(store.all().map((c) => c.id)).toEqual(["valid"]);
  });

  it("treats a non-array history file as empty", async () => {
    const plugin = fakePlugin();
    plugin._files.set("/plugins/ai-writer-assistant/history.json", '{"messages":[]}');
    const store = new HistoryStore(plugin);
    await store.load();
    expect(store.all()).toEqual([]);
  });

  it("rejects non-string scopes so resumed chats cannot widen their context", async () => {
    const plugin = fakePlugin();
    plugin._files.set("/plugins/ai-writer-assistant/history.json", JSON.stringify([{ ...convo("bad", 100), scope: ["file"] }]));
    const store = new HistoryStore(plugin);
    await store.load();
    expect(store.all()).toEqual([]);
  });

  it("returns copies from all()", async () => {
    const store = new HistoryStore(fakePlugin());
    await store.upsert(convo("a", 1));
    store.all().push(convo("ghost", 2));
    expect(store.all()).toHaveLength(1);
  });
});

describe("newId", () => {
  it("produces unique, non-empty ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { applyEdit, checkPath, VaultTools } from "../src/tools";
import { TFile } from "obsidian";

function fakeApp(files: Record<string, string>) {
  const store = { ...files };
  const mk = (path: string) => Object.assign(new TFile(), { path });
  return {
    store,
    app: {
      vault: {
        configDir: ".obsidian",
        getAbstractFileByPath: (p: string) => (p in store ? mk(p) : null),
        read: async (f: any) => store[f.path],
        modify: async (f: any, c: string) => { store[f.path] = c; },
        create: async (p: string, c: string) => { store[p] = c; },
        createFolder: async () => {},
      },
    } as any,
  };
}

describe("applyEdit", () => {
  it("replaces a unique passage", () => {
    expect(applyEdit("a b c", "b", "X")).toEqual({ ok: true, content: "a X c" });
  });
  it("rejects missing and ambiguous matches", () => {
    expect(applyEdit("a b", "z", "X").ok).toBe(false);
    expect(applyEdit("b b", "b", "X").ok).toBe(false);
    expect(applyEdit("a", "", "X").ok).toBe(false);
  });
});

describe("checkPath", () => {
  it("blocks traversal, absolute paths and the config folder", () => {
    expect(checkPath("../x.md", ".obsidian")).toBeTruthy();
    expect(checkPath("/x.md", ".obsidian")).toBeTruthy();
    expect(checkPath(".obsidian/plugins/a.md", ".obsidian")).toBeTruthy();
    expect(checkPath("Notes/a.md", ".obsidian")).toBeNull();
  });
});

describe("VaultTools", () => {
  it("applies an approved edit", async () => {
    const { app, store } = fakeApp({ "a.md": "hello world" });
    const t = new VaultTools(app, () => "ask", async () => true);
    expect(await t.run("edit_note", { path: "a.md", old_text: "world", new_text: "there" })).toMatch(/Updated/);
    expect(store["a.md"]).toBe("hello there");
    expect([...t.modified]).toEqual(["a.md"]);
  });
  it("does not write when declined", async () => {
    const { app, store } = fakeApp({ "a.md": "hello" });
    const t = new VaultTools(app, () => "ask", async () => false);
    expect(await t.run("append_to_note", { path: "a.md", content: "x" })).toMatch(/declined/);
    expect(store["a.md"]).toBe("hello");
  });
  it("skips confirmation in auto mode and refuses writes when off", async () => {
    const { app, store } = fakeApp({});
    let asked = 0;
    const auto = new VaultTools(app, () => "auto", async () => { asked++; return false; });
    await auto.run("create_note", { path: "n/new.md", content: "hi" });
    expect(store["n/new.md"]).toBe("hi");
    expect(asked).toBe(0);
    const off = new VaultTools(app, () => "off", async () => true);
    expect(await off.run("create_note", { path: "z.md", content: "x" })).toMatch(/disabled/);
    expect(store["z.md"]).toBeUndefined();
  });
  it("refuses to overwrite via create_note", async () => {
    const { app } = fakeApp({ "a.md": "x" });
    const t = new VaultTools(app, () => "auto", async () => true);
    expect(await t.run("create_note", { path: "a.md", content: "y" })).toMatch(/already exists/);
  });
});

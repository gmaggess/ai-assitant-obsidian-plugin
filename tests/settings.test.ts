import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types";

const host = vi.hoisted(() => ({ modern: true, updates: 0, names: [] as string[] }));
vi.mock("obsidian", async (original) => ({
  ...await original(),
  PluginSettingTab: class {
    containerEl = { empty() { host.names = []; } };
    update() { host.updates++; }
    hide() {}
  },
  Setting: class {
    controlEl = { createEl: () => ({ setAttr() {} }) };
    constructor() {}
    setName(name: string) { host.names.push(name); return this; }
    setDesc() { return this; }
    setHeading() { return this; }
    addText() { return this; }
    addDropdown() { return this; }
    addToggle() { return this; }
    addTextArea() { return this; }
    addButton(callback: (button: unknown) => void) {
      const button = { buttonEl: { addClass() {} }, setButtonText: () => button, onClick: () => button };
      callback(button);
      return this;
    }
  },
  requireApiVersion: () => host.modern,
}));

import { SettingsTab } from "../src/settings";

describe("searchable settings", () => {
  it("renders settings on an older host without calling modern APIs", () => {
    host.modern = false; host.updates = 0;
    const plugin = { settings: { ...DEFAULT_SETTINGS, allowEdits: false }, history: { all: () => [] } };
    const tab = new SettingsTab({} as never, plugin as never);
    tab.display();
    expect(host.names).toContain("Anthropic API key");
    expect(host.names).toContain("Saved conversations");
    expect(host.names).not.toContain("Require approval for changes");
    expect(host.updates).toBe(0);
    tab.hide();
  });
  it("indexes all configuration sections without revealing API keys", () => {
    const plugin = { settings: { ...DEFAULT_SETTINGS, anthropicApiKey: "secret-key" }, history: { all: () => [] } };
    const tab = new SettingsTab({} as never, plugin as never);
    const definitions = tab.getSettingDefinitions();
    const names = definitions.flatMap((group) => group.items?.map((row) => row.name) ?? []);
    expect(names).toEqual(expect.arrayContaining(["Anthropic API key", "Default scope", "Require approval for changes", "System prompt", "Saved conversations"]));
    expect(JSON.stringify(definitions)).not.toContain("secret-key");
  });

  it("refreshes declarative settings after choosing a different model", async () => {
    host.modern = true; host.updates = 0;
    const plugin = { settings: { ...DEFAULT_SETTINGS }, saveSettings: vi.fn().mockResolvedValue(undefined), history: { all: () => [] } };
    const tab = new SettingsTab({} as never, plugin as never);
    const row = tab.getSettingDefinitions().flatMap((group) => group.items).find((row) => row.name === "Claude model")!;
    let change: (value: string) => Promise<void> = async () => {};
    const dropdown = { addOption: () => dropdown, setValue: () => dropdown, onChange: (fn: typeof change) => { change = fn; return dropdown; } };
    const setting = {
      addDropdown(fn: (d: typeof dropdown) => void) { fn(dropdown); return setting; },
      addText() { return setting; },
      addButton() { return setting; },
    };
    row.render(setting as never);
    await change("claude-custom");
    expect(plugin.settings.anthropicModel).toBe("claude-custom");
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(host.updates).toBe(1);
  });
});

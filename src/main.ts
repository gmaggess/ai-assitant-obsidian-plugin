/** Register the chat view, settings tab, commands, and history store. */
import { Plugin, WorkspaceLeaf } from "obsidian";
import { ChatView, VIEW_TYPE } from "./view";
import { SettingsTab } from "./settings";
import { HistoryStore } from "./history";
import { SearchModal } from "./search";
import { loadSettings, PluginSettings } from "./types";

/** The Obsidian plugin: wires view, settings, history, and commands together. */
export default class AIWriterAssistantPlugin extends Plugin {
  settings!: PluginSettings;
  history!: HistoryStore;

  /** Load settings and history, then register the view, tab, and commands. */
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.history = new HistoryStore(this);
    await this.history.load();
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-square", "Open chat panel", () => this.activateView());
    this.addCommand({ id: "open-chat", name: "Open chat panel", callback: () => this.activateView() });
    this.addCommand({ id: "search-history", name: "Search past conversations", callback: () => new SearchModal(this.app, this).open() });
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  /** Reveal, or open, the chat panel, reusing an existing leaf when present. */
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Open the panel and resume a stored conversation by id. */
  async openConversation(id: string) {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof ChatView) await view.loadConversation(id);
  }

  /** Persist the current settings to disk. */
  async saveSettings() { await this.saveData(this.settings); }
}

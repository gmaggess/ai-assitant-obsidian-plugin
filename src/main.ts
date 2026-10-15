import { Plugin, WorkspaceLeaf } from "obsidian";
import { ChatView, VIEW_TYPE } from "./view";
import { SettingsTab } from "./settings";
import { HistoryStore } from "./history";
import { SearchModal } from "./search";
import { DEFAULT_SETTINGS, PluginSettings } from "./types";

export default class ScopedAIChatPlugin extends Plugin {
  settings!: PluginSettings;
  history!: HistoryStore;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.history = new HistoryStore(this);
    await this.history.load();
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-square", "Open Scoped AI Chat", () => this.activateView());
    this.addCommand({ id: "open-chat", name: "Open chat panel", callback: () => this.activateView() });
    this.addCommand({ id: "search-history", name: "Search past conversations", callback: () => new SearchModal(this.app, this).open() });
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openConversation(id: string) {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof ChatView) view.loadConversation(id);
  }

  async saveSettings() { await this.saveData(this.settings); }
}

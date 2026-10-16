import { App, Notice, PluginSettingTab, requireApiVersion, Setting } from "obsidian";
import type AIWriterAssistantPlugin from "./main";
import { fetchModels } from "./providers";
import { DONATION_URL } from "./donation";
import { AnthropicEffortMode, Effort, Provider, Scope } from "./types";
import { errorMessage } from "./data";

interface SettingsRow {
  name: string;
  desc?: string;
  visible?: () => boolean;
  render: (setting: Setting) => void | (() => void);
}
interface SettingsSection { type: "group"; heading: string; items: SettingsRow[]; }

export class SettingsTab extends PluginSettingTab {
  private legacyCleanups: (() => void)[] = [];
  constructor(app: App, private plugin: AIWriterAssistantPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingsSection[] {
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    const row = (name: string, desc: string, render: SettingsRow["render"], visible?: () => boolean): SettingsRow => ({ name, desc, render, visible });
    const models = (["anthropic", "openai"] as const).map((p) => {
      const label = p === "anthropic" ? "Claude" : "ChatGPT";
      return row(`${label} model`, "Pick from the list, or type any model ID.", (setting) => {
        setting.addDropdown((d) => {
          const list = p === "anthropic" ? s.anthropicModels : s.openaiModels;
          list.forEach((m) => { d.addOption(m, m); });
          d.setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel).onChange(async (v) => {
            if (p === "anthropic") s.anthropicModel = v; else s.openaiModel = v;
            await save(); this.refreshSettings();
          });
        }).addText((t) => t.setPlaceholder("Custom model ID").setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel)
          .onChange(async (v) => { if (p === "anthropic") s.anthropicModel = v.trim(); else s.openaiModel = v.trim(); await save(); }))
          .addButton((b) => b.setButtonText("Refresh list").onClick(async () => {
            try {
              const models = await fetchModels(s, p);
              if (!models.length) throw new Error("No models returned");
              if (p === "anthropic") s.anthropicModels = models; else s.openaiModels = models;
              await save(); new Notice(`Loaded ${models.length} ${label} models`); this.refreshSettings();
            } catch (e) { new Notice(errorMessage(e)); }
          }));
      });
    });
    return [
      { type: "group", heading: "API keys", items: [
        row("Anthropic API key", "console.anthropic.com → API keys", (setting) => {
          setting.addText((t) => { t.inputEl.type = "password"; t.setValue(s.anthropicApiKey).onChange(async (v) => { s.anthropicApiKey = v.trim(); await save(); }); });
        }),
        row("OpenAI API key", "platform.openai.com → API keys", (setting) => {
          setting.addText((t) => { t.inputEl.type = "password"; t.setValue(s.openaiApiKey).onChange(async (v) => { s.openaiApiKey = v.trim(); await save(); }); });
        }),
      ] },
      { type: "group", heading: "Model", items: [
        row("Provider", "", (setting) => { setting.addDropdown((d) => d.addOptions({ anthropic: "Claude", openai: "ChatGPT" }).setValue(s.provider)
          .onChange(async (v) => { s.provider = v as Provider; await save(); })); }),
        ...models,
        row("Effort level", "How hard the model thinks. OpenAI caps at high.", (setting) => {
          setting.addDropdown((d) => d.addOptions({ low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }).setValue(s.effort)
            .onChange(async (v) => { s.effort = v as Effort; await save(); }));
        }),
        row("Claude effort method", "Choose an effort parameter, thinking budget, or no extra reasoning.", (setting) => {
          setting.addDropdown((d) => d.addOptions({ effort: "Effort parameter", "thinking-budget": "Thinking budget", none: "Off" }).setValue(s.anthropicEffortMode)
            .onChange(async (v) => { s.anthropicEffortMode = v as AnthropicEffortMode; await save(); }));
        }),
        row("Max output tokens", "", (setting) => { setting.addText((t) => t.setValue(String(s.maxOutputTokens))
          .onChange(async (v) => { const n = parseInt(v); if (n > 0) { s.maxOutputTokens = n; await save(); } })); }),
      ] },
      { type: "group", heading: "Scope", items: [
        row("Default scope", "Can be changed per chat in the chat panel.", (setting) => { setting.addDropdown((d) => d.addOptions({ file: "Current file", folder: "Current folder", vault: "Whole vault" }).setValue(s.defaultScope)
          .onChange(async (v) => { s.defaultScope = v as Scope; await save(); })); }),
        row("Folder scope includes subfolders", "", (setting) => { setting.addToggle((t) => t.setValue(s.includeSubfolders)
          .onChange(async (v) => { s.includeSubfolders = v; await save(); })); }),
        row("Max context characters", "Notes beyond this limit are dropped (active note always first).", (setting) => { setting.addText((t) => t.setValue(String(s.maxContextChars))
          .onChange(async (v) => { const n = parseInt(v); if (n > 0) { s.maxContextChars = n; await save(); } })); }),
      ] },
      { type: "group", heading: "File editing", items: [
        row("Let the AI modify notes", "Allow the assistant to create and edit notes. Turn off for a read-only chat.", (setting) => { setting.addToggle((t) => t.setValue(s.allowEdits)
          .onChange(async (v) => { s.allowEdits = v; await save(); this.refreshSettings(); })); }),
        row("Require approval for changes", "Show a preview and wait for approval before writing. Turn off to apply changes immediately.", (setting) => { setting.addToggle((t) => t.setValue(s.requireApproval)
          .onChange(async (v) => { s.requireApproval = v; await save(); })); }, () => s.allowEdits),
        row("Max tool steps per request", "Safety cap on how many read/edit steps the AI can take before it must stop.", (setting) => { setting.addText((t) => t.setValue(String(s.maxToolRounds))
          .onChange(async (v) => { const n = parseInt(v); if (n > 0 && n <= 200) { s.maxToolRounds = n; await save(); } })); }, () => s.allowEdits),
      ] },
      { type: "group", heading: "Conversation history", items: [
        row("Save-as-note folder", "Where exported conversations are saved in your vault.", (setting) => { setting.addText((t) => t.setPlaceholder("Conversation folder").setValue(s.notesFolder)
          .onChange(async (v) => { s.notesFolder = v; await save(); })); }),
        row("Saved conversations", `${this.plugin.history.all().length} chat(s) stored with the plugin. Search them with the history search button.`, (setting) => {
          let timer: number | undefined;
          let armed = false;
          setting.addButton((b) => {
            if (requireApiVersion("1.13.0")) b.setDestructive();
            else b.buttonEl.addClass("mod-warning");
            b.setButtonText("Delete all").onClick(async () => {
              if (!armed) {
                armed = true; b.setButtonText("Click again to confirm");
                timer = window.setTimeout(() => { armed = false; b.setButtonText("Delete all"); }, 4000);
                return;
              }
              if (timer !== undefined) window.clearTimeout(timer);
              await this.plugin.history.clear(); new Notice("History cleared"); this.refreshSettings();
            });
          });
          return () => { if (timer !== undefined) window.clearTimeout(timer); };
        }),
        row("System prompt", "", (setting) => { setting.addTextArea((t) => { t.inputEl.rows = 5; t.setValue(s.systemPrompt)
          .onChange(async (v) => { s.systemPrompt = v; await save(); }); }); }),
      ] },
      { type: "group", heading: "Support", items: [
        row("Support development", "", (setting) => {
          const a = setting.controlEl.createEl("a", { text: "Buy me a coffee", href: DONATION_URL });
          a.setAttr("target", "_blank"); a.setAttr("rel", "noopener");
        }),
      ] },
    ];
  }

  /** Compatibility renderer for Obsidian versions before 1.13.0. */
  display() { this.renderLegacy(); }

  private refreshSettings() {
    if (requireApiVersion("1.13.0")) this.update();
    else this.renderLegacy();
  }

  private renderLegacy() {
    this.cleanLegacy();
    this.containerEl.empty();
    for (const group of this.getSettingDefinitions()) {
      new Setting(this.containerEl).setName(group.heading).setHeading();
      for (const row of group.items) {
        if (row.visible && !row.visible()) continue;
        const setting = new Setting(this.containerEl).setName(row.name).setDesc(row.desc ?? "");
        const cleanup = row.render(setting);
        if (cleanup) this.legacyCleanups.push(cleanup);
      }
    }
  }

  private cleanLegacy() { for (const cleanup of this.legacyCleanups.splice(0)) cleanup(); }
  hide() { this.cleanLegacy(); super.hide(); }
}

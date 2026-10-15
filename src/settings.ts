import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ScopedAIChatPlugin from "./main";
import { fetchModels } from "./providers";
import { DONATION_URL } from "./donation";
import { AnthropicEffortMode, Effort, Provider, Scope } from "./types";

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ScopedAIChatPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    const coffee = containerEl.createDiv({ attr: { style: "display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:12px;border-radius:8px;background:var(--background-secondary)" } });
    coffee.createSpan({ text: "Enjoying Scoped AI Chat? Support its development — opens Venmo in a new tab." });
    const a = coffee.createEl("a", { text: "\u2615 Buy me a coffee on Venmo", href: DONATION_URL, cls: "mod-cta" });
    a.setAttr("target", "_blank");
    a.setAttr("style", "padding:6px 12px;border-radius:6px;background:var(--interactive-accent);color:var(--text-on-accent);text-decoration:none;font-weight:600");

    containerEl.createEl("h3", { text: "API keys" });
    new Setting(containerEl).setName("Anthropic API key").setDesc("console.anthropic.com → API keys")
      .addText((t) => { t.inputEl.type = "password"; t.setValue(s.anthropicApiKey).onChange(async (v) => { s.anthropicApiKey = v.trim(); await save(); }); });
    new Setting(containerEl).setName("OpenAI API key").setDesc("platform.openai.com → API keys")
      .addText((t) => { t.inputEl.type = "password"; t.setValue(s.openaiApiKey).onChange(async (v) => { s.openaiApiKey = v.trim(); await save(); }); });

    containerEl.createEl("h3", { text: "Model" });
    new Setting(containerEl).setName("Default provider")
      .addDropdown((d) => d.addOptions({ anthropic: "Claude", openai: "ChatGPT" }).setValue(s.provider)
        .onChange(async (v) => { s.provider = v as Provider; await save(); }));

    for (const p of ["anthropic", "openai"] as const) {
      const label = p === "anthropic" ? "Claude" : "ChatGPT";
      new Setting(containerEl).setName(`${label} model`).setDesc("Pick from the list, or type any model ID.")
        .addDropdown((d) => {
          const list = p === "anthropic" ? s.anthropicModels : s.openaiModels;
          list.forEach((m) => d.addOption(m, m));
          d.setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel)
            .onChange(async (v) => { if (p === "anthropic") s.anthropicModel = v; else s.openaiModel = v; await save(); this.display(); });
        })
        .addText((t) => t.setPlaceholder("custom model id").setValue(p === "anthropic" ? s.anthropicModel : s.openaiModel)
          .onChange(async (v) => { if (p === "anthropic") s.anthropicModel = v.trim(); else s.openaiModel = v.trim(); await save(); }))
        .addButton((b) => b.setButtonText("Refresh list").onClick(async () => {
          try {
            const models = await fetchModels(s, p);
            if (!models.length) throw new Error("No models returned");
            if (p === "anthropic") s.anthropicModels = models; else s.openaiModels = models;
            await save(); new Notice(`Loaded ${models.length} ${label} models`); this.display();
          } catch (e: any) { new Notice(e.message ?? String(e)); }
        }));
    }

    new Setting(containerEl).setName("Effort level").setDesc("How hard the model thinks. OpenAI caps at high.")
      .addDropdown((d) => d.addOptions({ low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" })
        .setValue(s.effort).onChange(async (v) => { s.effort = v as Effort; await save(); }));
    new Setting(containerEl).setName("Claude effort method")
      .setDesc("'Effort' uses the newer effort parameter; 'Thinking budget' uses extended thinking tokens (widest model support).")
      .addDropdown((d) => d.addOptions({ effort: "Effort parameter", "thinking-budget": "Thinking budget", none: "Off" })
        .setValue(s.anthropicEffortMode).onChange(async (v) => { s.anthropicEffortMode = v as AnthropicEffortMode; await save(); }));
    new Setting(containerEl).setName("Max output tokens")
      .addText((t) => t.setValue(String(s.maxOutputTokens)).onChange(async (v) => { const n = parseInt(v); if (n > 0) { s.maxOutputTokens = n; await save(); } }));

    containerEl.createEl("h3", { text: "Scope" });
    new Setting(containerEl).setName("Default scope").setDesc("Can be changed per chat in the chat panel.")
      .addDropdown((d) => d.addOptions({ file: "Current file", folder: "Current folder", vault: "Whole vault" })
        .setValue(s.defaultScope).onChange(async (v) => { s.defaultScope = v as Scope; await save(); }));
    new Setting(containerEl).setName("Folder scope includes subfolders")
      .addToggle((t) => t.setValue(s.includeSubfolders).onChange(async (v) => { s.includeSubfolders = v; await save(); }));
    new Setting(containerEl).setName("Max context characters").setDesc("Notes beyond this limit are dropped (active note always first).")
      .addText((t) => t.setValue(String(s.maxContextChars)).onChange(async (v) => { const n = parseInt(v); if (n > 0) { s.maxContextChars = n; await save(); } }));
    containerEl.createEl("h3", { text: "Conversation history" });
    new Setting(containerEl).setName("Save-as-note folder").setDesc("Where \"Save as note\" puts conversations in your vault.")
      .addText((t) => t.setPlaceholder("AI Chats").setValue(s.notesFolder).onChange(async (v) => { s.notesFolder = v; await save(); }));
    new Setting(containerEl).setName("Saved conversations")
      .setDesc(`${this.plugin.history.all().length} chat(s) stored privately with the plugin. Search them with the "Search history" button.`)
      .addButton((b) => b.setButtonText("Delete all").setWarning().onClick(async () => {
        if (!confirm("Delete all saved conversations?")) return;
        await this.plugin.history.clear(); new Notice("History cleared"); this.display();
      }));
    new Setting(containerEl).setName("System prompt")
      .addTextArea((t) => { t.inputEl.rows = 5; t.setValue(s.systemPrompt).onChange(async (v) => { s.systemPrompt = v; await save(); }); });
  }
}

export type Provider = "anthropic" | "openai";
export type Scope = "file" | "folder" | "vault";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type AnthropicEffortMode = "effort" | "thinking-budget" | "none";

export interface ChatMessage { role: "user" | "assistant"; content: string; }

export interface PluginSettings {
  anthropicApiKey: string;
  openaiApiKey: string;
  provider: Provider;
  anthropicModel: string;
  openaiModel: string;
  anthropicModels: string[];
  openaiModels: string[];
  effort: Effort;
  anthropicEffortMode: AnthropicEffortMode;
  defaultScope: Scope;
  includeSubfolders: boolean;
  maxContextChars: number;
  maxOutputTokens: number;
  systemPrompt: string;
  notesFolder: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  anthropicApiKey: "",
  openaiApiKey: "",
  provider: "anthropic",
  anthropicModel: "claude-sonnet-4-5",
  openaiModel: "gpt-5",
  anthropicModels: ["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openaiModels: ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
  effort: "medium",
  anthropicEffortMode: "thinking-budget",
  defaultScope: "file",
  includeSubfolders: false,
  maxContextChars: 200000,
  maxOutputTokens: 8000,
  notesFolder: "AI Chats",
  systemPrompt:
    "You are a helpful assistant inside the user's Obsidian vault. Answer ONLY using the notes provided in the context. If the answer is not in the provided notes, say so. Cite note paths when relevant.",
};

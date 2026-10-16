export type Provider = "anthropic" | "openai";
export type Scope = "file" | "folder" | "vault";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type AnthropicEffortMode = "effort" | "thinking-budget" | "none";

export type EditMode = "ask" | "auto" | "off";

export interface ToolDef { name: string; description: string; schema: Record<string, unknown>; }
export interface ToolHost { defs: ToolDef[]; run(name: string, input: unknown): Promise<string>; }

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
  allowEdits: boolean;
  requireApproval: boolean;
  maxToolRounds: number;
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
  allowEdits: true,
  requireApproval: true,
  maxToolRounds: 25,
  systemPrompt:
    "You are a helpful assistant inside the user's Obsidian vault. Answer ONLY using the notes provided in the context. If the answer is not in the provided notes, say so. Cite note paths when relevant.",
};

export function editModeOf(s: Pick<PluginSettings, "allowEdits" | "requireApproval">): EditMode {
  return !s.allowEdits ? "off" : s.requireApproval ? "ask" : "auto";
}
import { arrayOf, recordOf } from "./data";


export function loadSettings(value: unknown): PluginSettings {
  const raw = recordOf(value);
  const defaults = DEFAULT_SETTINGS;
  const text = (key: keyof PluginSettings) => typeof raw[key] === "string" ? raw[key] : defaults[key];
  const number = (key: "maxContextChars" | "maxOutputTokens" | "maxToolRounds") => {
    const n = raw[key];
    return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && (key !== "maxToolRounds" || n <= 200) ? n : defaults[key];
  };
  const list = (key: "anthropicModels" | "openaiModels") => Array.isArray(raw[key])
    ? arrayOf(raw[key]).filter((v): v is string => typeof v === "string") : [...defaults[key]];
  const result = { ...defaults, anthropicModels: list("anthropicModels"), openaiModels: list("openaiModels") };
  for (const key of ["anthropicApiKey", "openaiApiKey", "anthropicModel", "openaiModel", "systemPrompt", "notesFolder"] as const) {
    const candidate = text(key);
    if (typeof candidate === "string") result[key] = candidate;
  }
  for (const key of ["allowEdits", "requireApproval", "includeSubfolders"] as const) {
    const candidate = raw[key];
    if (typeof candidate === "boolean") result[key] = candidate;
  }
  result.maxContextChars = number("maxContextChars");
  result.maxOutputTokens = number("maxOutputTokens");
  result.maxToolRounds = number("maxToolRounds");
  if (raw.provider === "anthropic" || raw.provider === "openai") result.provider = raw.provider;
  if (raw.defaultScope === "file" || raw.defaultScope === "folder" || raw.defaultScope === "vault") result.defaultScope = raw.defaultScope;
  if (raw.anthropicEffortMode === "effort" || raw.anthropicEffortMode === "thinking-budget" || raw.anthropicEffortMode === "none") result.anthropicEffortMode = raw.anthropicEffortMode;
  if (raw.effort === "low" || raw.effort === "medium" || raw.effort === "high" || raw.effort === "xhigh" || raw.effort === "max") result.effort = raw.effort;
  return result;
}

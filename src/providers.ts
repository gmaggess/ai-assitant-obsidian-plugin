import { requestUrl } from "obsidian";
import { ChatMessage, Effort, PluginSettings } from "./types";

const THINKING_BUDGET: Record<Effort, number> = { low: 2048, medium: 6000, high: 16000, xhigh: 24000, max: 32000 };

function errMsg(status: number, body: any): string {
  const m = body?.error?.message ?? body?.message ?? JSON.stringify(body);
  return `API error ${status}: ${m}`;
}

export async function sendChat(s: PluginSettings, system: string, messages: ChatMessage[]): Promise<string> {
  return s.provider === "anthropic" ? sendAnthropic(s, system, messages) : sendOpenAI(s, system, messages);
}

async function sendAnthropic(s: PluginSettings, system: string, messages: ChatMessage[]): Promise<string> {
  if (!s.anthropicApiKey) throw new Error("Add your Anthropic API key in plugin settings.");
  const body: any = { model: s.anthropicModel, max_tokens: s.maxOutputTokens, system, messages };
  if (s.anthropicEffortMode === "effort") {
    body.output_config = { effort: s.effort };
  } else if (s.anthropicEffortMode === "thinking-budget") {
    const budget = Math.min(THINKING_BUDGET[s.effort], Math.max(1024, s.maxOutputTokens - 1024));
    body.thinking = { type: "enabled", budget_tokens: budget };
    if (body.max_tokens <= budget) body.max_tokens = budget + 2048;
  }
  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    throw: false,
    headers: {
      "content-type": "application/json",
      "x-api-key": s.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  const data = res.json;
  if (data.stop_reason === "refusal") return "_The model declined to answer this request._";
  return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

async function sendOpenAI(s: PluginSettings, system: string, messages: ChatMessage[]): Promise<string> {
  if (!s.openaiApiKey) throw new Error("Add your OpenAI API key in plugin settings.");
  const effort = s.effort === "max" || s.effort === "xhigh" ? "high" : s.effort;
  const body: any = {
    model: s.openaiModel,
    instructions: system,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: s.maxOutputTokens,
    store: false,
    reasoning: { effort },
  };
  let res = await post(s, body);
  // Non-reasoning models reject the reasoning param: retry once without it.
  if (res.status === 400 && /reasoning/i.test(JSON.stringify(res.json))) {
    delete body.reasoning;
    res = await post(s, body);
  }
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  const data = res.json;
  if (data.output_text) return data.output_text;
  const out: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "message") for (const c of item.content ?? []) if (c.type === "output_text") out.push(c.text);
  }
  return out.join("\n") || "_(empty response — try raising Max output tokens)_";
}

function post(s: PluginSettings, body: any) {
  return requestUrl({
    url: "https://api.openai.com/v1/responses",
    method: "POST",
    throw: false,
    headers: { "content-type": "application/json", authorization: `Bearer ${s.openaiApiKey}` },
    body: JSON.stringify(body),
  });
}

export async function fetchModels(s: PluginSettings, provider: "anthropic" | "openai"): Promise<string[]> {
  if (provider === "anthropic") {
    const res = await requestUrl({
      url: "https://api.anthropic.com/v1/models?limit=100",
      throw: false,
      headers: { "x-api-key": s.anthropicApiKey, "anthropic-version": "2023-06-01" },
    });
    if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
    return (res.json.data ?? []).map((m: any) => m.id);
  }
  const res = await requestUrl({
    url: "https://api.openai.com/v1/models",
    throw: false,
    headers: { authorization: `Bearer ${s.openaiApiKey}` },
  });
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  return (res.json.data ?? [])
    .map((m: any) => m.id as string)
    .filter((id: string) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search)/.test(id))
    .sort();
}

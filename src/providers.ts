import { requestUrl } from "obsidian";
import { ChatMessage, Effort, PluginSettings, ToolHost } from "./types";
import { errorMessage, parseJson, recordOf, recordsOf, toolString } from "./data";

// Models that rejected `thinking.type: enabled` this session; they get adaptive thinking up front.
const ADAPTIVE_ONLY = new Set<string>();
const THINKING_BUDGET: Record<Effort, number> = { low: 2048, medium: 6000, high: 16000, xhigh: 24000, max: 32000 };

function errMsg(status: number, body: unknown): string {
  const data = recordOf(body);
  const m = recordOf(data.error).message ?? data.message ?? JSON.stringify(body);
  return `API error ${status}: ${typeof m === "string" ? m : JSON.stringify(m)}`;
}

export async function sendChat(s: PluginSettings, system: string, messages: ChatMessage[], tools?: ToolHost): Promise<string> {
  return s.provider === "anthropic" ? sendAnthropic(s, system, messages, tools) : sendOpenAI(s, system, messages, tools);
}

async function sendAnthropic(s: PluginSettings, system: string, messages: ChatMessage[], tools?: ToolHost): Promise<string> {
  if (!s.anthropicApiKey) throw new Error("Add your Anthropic API key in plugin settings.");
  const msgs: unknown[] = [...messages];
  const body: {
    model: string; max_tokens: number; system: string; messages: unknown[];
    tools?: Record<string, unknown>[];
    thinking?: { type: string; budget_tokens?: number };
    output_config?: { effort: Effort };
  } = { model: s.anthropicModel, max_tokens: s.maxOutputTokens, system, messages: msgs };
  if (tools) body.tools = tools.defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.schema }));
  const useAdaptive = () => { body.thinking = { type: "adaptive" }; body.output_config = { effort: s.effort }; };
  if (s.anthropicEffortMode === "thinking-budget" && ADAPTIVE_ONLY.has(s.anthropicModel)) {
    useAdaptive();
  } else if (s.anthropicEffortMode === "effort") {
    body.output_config = { effort: s.effort };
  } else if (s.anthropicEffortMode === "thinking-budget") {
    const budget = Math.min(THINKING_BUDGET[s.effort], Math.max(1024, s.maxOutputTokens - 1024));
    body.thinking = { type: "enabled", budget_tokens: budget };
    if (body.max_tokens <= budget) body.max_tokens = budget + 2048;
  }
  const texts: string[] = [];
  for (let round = 0; round < (s.maxToolRounds || 25); round++) {
    const call = () => requestUrl({
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
    let res = await call();
    // Newer models reject manual thinking budgets: switch to adaptive thinking and remember it for this model.
    if (res.status === 400 && body.thinking?.type === "enabled" && /thinking\.type\.enabled|adaptive/i.test(JSON.stringify(res.json))) {
      ADAPTIVE_ONLY.add(s.anthropicModel);
      useAdaptive();
      res = await call();
    }
    if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
    const data = recordOf(res.json);
    if (data.stop_reason === "refusal") return "_The model declined to answer this request._";
    const content = recordsOf(data.content);
    const text = content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
    if (text) texts.push(text);
    const calls = content.filter((b) => b.type === "tool_use");
    if (!tools || data.stop_reason !== "tool_use" || calls.length === 0) return texts.join("\n\n");
    // Echo the assistant turn verbatim (keeps thinking blocks/signatures intact), then answer each tool call.
    msgs.push({ role: "assistant", content });
    const results: unknown[] = [];
    for (const c of calls) {
      const name = toolString(c.name);
      const id = toolString(c.id);
      let out: string;
      try { out = await tools.run(name, c.input); } catch (e) { out = `Error: ${errorMessage(e)}`; }
      results.push({ type: "tool_result", tool_use_id: id, content: out });
    }
    msgs.push({ role: "user", content: results });
  }
  texts.push("_(stopped after too many tool steps)_");
  return texts.join("\n\n");
}

async function sendOpenAI(s: PluginSettings, system: string, messages: ChatMessage[], tools?: ToolHost): Promise<string> {
  if (!s.openaiApiKey) throw new Error("Add your OpenAI API key in plugin settings.");
  const effort = s.effort === "max" || s.effort === "xhigh" ? "high" : s.effort;
  const input: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const body: Record<string, unknown> = {
    model: s.openaiModel,
    instructions: system,
    input,
    max_output_tokens: s.maxOutputTokens,
    store: false,
    reasoning: { effort },
  };
  if (tools) {
    body.tools = tools.defs.map((d) => ({ type: "function", name: d.name, description: d.description, parameters: d.schema }));
    // Stateless (store: false) tool loops need reasoning items passed back, which requires encrypted content.
    body.include = ["reasoning.encrypted_content"];
  }
  const texts: string[] = [];
  for (let round = 0; round < (s.maxToolRounds || 25); round++) {
    let res = await post(s, body);
    // Non-reasoning models reject the reasoning param: retry once without it.
    if (res.status === 400 && /reasoning/i.test(JSON.stringify(res.json))) {
      delete body.reasoning;
      delete body.include;
      res = await post(s, body);
    }
    if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
    const data = recordOf(res.json);
    const output = recordsOf(data.output);
    const calls = output.filter((i) => i.type === "function_call");
    if (!tools || calls.length === 0) {
      const parts: string[] = [];
      if (typeof data.output_text === "string" && data.output_text) parts.push(data.output_text);
      else for (const item of output) {
        if (item.type === "message") for (const c of recordsOf(item.content)) if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      }
      if (parts.length) texts.push(parts.join("\n"));
      return texts.join("\n\n") || "_(empty response — try raising Max output tokens)_";
    }
    for (const item of output) {
      if (item.type === "message") for (const c of recordsOf(item.content)) if (c.type === "output_text" && typeof c.text === "string") texts.push(c.text);
    }
    input.push(...output);
    for (const c of calls) {
      const name = toolString(c.name);
      const id = toolString(c.call_id);
      let out: string;
      try { out = await tools.run(name, parseJson(toolString(c.arguments))); } catch (e) { out = `Error: ${errorMessage(e)}`; }
      input.push({ type: "function_call_output", call_id: id, output: out });
    }
  }
  texts.push("_(stopped after too many tool steps)_");
  return texts.join("\n\n");
}

function post(s: PluginSettings, body: Record<string, unknown>) {
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
    return recordsOf(recordOf(res.json).data).flatMap((m) => typeof m.id === "string" ? [m.id] : []);
  }
  const res = await requestUrl({
    url: "https://api.openai.com/v1/models",
    throw: false,
    headers: { authorization: `Bearer ${s.openaiApiKey}` },
  });
  if (res.status >= 400) throw new Error(errMsg(res.status, res.json));
  return recordsOf(recordOf(res.json).data)
    .flatMap((m) => typeof m.id === "string" ? [m.id] : [])
    .filter((id: string) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search)/.test(id))
    .sort();
}

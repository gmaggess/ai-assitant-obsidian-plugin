import { describe, it, expect, beforeEach } from "vitest";
import { sendChat, fetchModels } from "../src/providers";
import { DEFAULT_SETTINGS, PluginSettings } from "../src/types";
import { mockRequestUrl, resetRequestUrlCalls, getRequestUrlCalls } from "./mocks/obsidian";

function settings(over: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_SETTINGS, anthropicApiKey: "sk-test", openaiApiKey: "sk-openai-test", ...over };
}

describe("sendChat — Anthropic", () => {
  beforeEach(() => resetRequestUrlCalls());

  it("throws without an API key", async () => {
    await expect(sendChat(settings({ anthropicApiKey: "" }), "sys", [])).rejects.toThrow(/Anthropic API key/);
  });

  it("sends model, max_tokens and system prompt", async () => {
    mockRequestUrl(async () => ({ status: 200, json: { content: [{ type: "text", text: "hi" }] }, text: "" }));
    const out = await sendChat(settings({ anthropicModel: "claude-x" }), "sys prompt", [
      { role: "user", content: "q" },
    ]);
    expect(out).toBe("hi");
    const call = getRequestUrlCalls()[0];
    expect(call.url).toContain("api.anthropic.com/v1/messages");
    const body = JSON.parse(call.body!);
    expect(body.model).toBe("claude-x");
    expect(body.system).toBe("sys prompt");
    expect(body.messages).toEqual([{ role: "user", content: "q" }]);
  });

  it("maps effort mode 'effort' to output_config", async () => {
    mockRequestUrl(async () => ({ status: 200, json: { content: [{ type: "text", text: "ok" }] }, text: "" }));
    await sendChat(settings({ anthropicEffortMode: "effort", effort: "high" }), "s", []);
    const body = JSON.parse(getRequestUrlCalls()[0].body!);
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.thinking).toBeUndefined();
  });

  it("maps effort mode 'thinking-budget' to a clamped thinking budget", async () => {
    mockRequestUrl(async () => ({ status: 200, json: { content: [{ type: "text", text: "ok" }] }, text: "" }));
    await sendChat(settings({ anthropicEffortMode: "thinking-budget", effort: "max", maxOutputTokens: 3000 }), "s", []);
    const body = JSON.parse(getRequestUrlCalls()[0].body!);
    expect(body.thinking.type).toBe("enabled");
    // budget = min(32000, max(1024, 3000-1024)) = 1976; max_tokens (3000) still above it, so unchanged
    expect(body.thinking.budget_tokens).toBe(1976);
    expect(body.max_tokens).toBe(3000);
  });

  it("ignores thinking entirely when effort mode is 'none'", async () => {
    mockRequestUrl(async () => ({ status: 200, json: { content: [{ type: "text", text: "ok" }] }, text: "" }));
    await sendChat(settings({ anthropicEffortMode: "none" }), "s", []);
    const body = JSON.parse(getRequestUrlCalls()[0].body!);
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it("returns a decline message on refusal", async () => {
    mockRequestUrl(async () => ({ status: 200, json: { stop_reason: "refusal", content: [] }, text: "" }));
    const out = await sendChat(settings(), "s", []);
    expect(out).toMatch(/declined/);
  });

  it("surfaces API errors", async () => {
    mockRequestUrl(async () => ({ status: 401, json: { error: { message: "bad key" } }, text: "" }));
    await expect(sendChat(settings(), "s", [])).rejects.toThrow(/401.*bad key/s);
  });
});

describe("sendChat — OpenAI", () => {
  beforeEach(() => resetRequestUrlCalls());

  it("throws without an API key", async () => {
    await expect(sendChat(settings({ openaiApiKey: "", provider: "openai" }), "sys", [])).rejects.toThrow(
      /OpenAI API key/
    );
  });

  it("caps xhigh and max at 'high' and sends instructions/input", async () => {
    mockRequestUrl(async () => ({ status: 200, json: { output_text: "answer" }, text: "" }));
    const out = await sendChat(settings({ provider: "openai", effort: "max", openaiModel: "gpt-5" }), "sys", [
      { role: "user", content: "hello" },
    ]);
    expect(out).toBe("answer");
    const call = getRequestUrlCalls()[0];
    expect(call.url).toContain("api.openai.com/v1/responses");
    const body = JSON.parse(call.body!);
    expect(body.model).toBe("gpt-5");
    expect(body.instructions).toBe("sys");
    expect(body.input).toEqual([{ role: "user", content: "hello" }]);
    expect(body.reasoning).toEqual({ effort: "high" });
  });

  it("retries without reasoning when the model rejects it", async () => {
    mockRequestUrl(async (opts) => {
      const body = JSON.parse(opts.body!);
      if (body.reasoning) return { status: 400, json: { error: { message: "reasoning is not supported" } }, text: "" };
      return { status: 200, json: { output_text: "ok" }, text: "" };
    });
    const out = await sendChat(settings({ provider: "openai" }), "s", []);
    expect(out).toBe("ok");
    expect(getRequestUrlCalls().length).toBe(2);
    expect(JSON.parse(getRequestUrlCalls()[1].body!).reasoning).toBeUndefined();
  });

  it("extracts text from output blocks when output_text is missing", async () => {
    mockRequestUrl(async () => ({
      status: 200,
      json: {
        output: [{ type: "message", content: [{ type: "output_text", text: "part1" }, { type: "output_text", text: "part2" }] }],
      },
      text: "",
    }));
    expect(await sendChat(settings({ provider: "openai" }), "s", [])).toBe("part1\npart2");
  });
});

describe("fetchModels", () => {
  beforeEach(() => resetRequestUrlCalls());

  it("returns Anthropic model ids", async () => {
    mockRequestUrl(async () => ({ status: 200, json: { data: [{ id: "claude-a" }, { id: "claude-b" }] }, text: "" }));
    expect(await fetchModels(settings(), "anthropic")).toEqual(["claude-a", "claude-b"]);
  });

  it("filters OpenAI's list down to chat models", async () => {
    mockRequestUrl(async () => ({
      status: 200,
      json: {
        data: [
          { id: "gpt-5" },
          { id: "gpt-5-mini" },
          { id: "o3" },
          { id: "text-embedding-3-small" },
          { id: "whisper-1" },
          { id: "gpt-image-1" },
          { id: "dall-e-3" },
        ],
      },
      text: "",
    }));
    const models = await fetchModels(settings(), "openai");
    expect(models).toEqual(["gpt-5", "gpt-5-mini", "o3"].sort());
  });

  it("throws on API errors", async () => {
    mockRequestUrl(async () => ({ status: 403, json: { error: { message: "denied" } }, text: "" }));
    await expect(fetchModels(settings(), "anthropic")).rejects.toThrow(/403/);
  });
});

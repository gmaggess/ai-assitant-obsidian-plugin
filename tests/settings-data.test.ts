import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../src/types";

describe("persisted settings", () => {
  it("rejects malformed settings while preserving valid values", () => {
    const settings = loadSettings({ provider: "other", maxToolRounds: -2, allowEdits: "yes", openaiModel: "gpt-custom", anthropicModels: [null, "claude-custom"] });
    expect(settings.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(settings.maxToolRounds).toBe(DEFAULT_SETTINGS.maxToolRounds);
    expect(settings.allowEdits).toBe(true);
    expect(settings.openaiModel).toBe("gpt-custom");
    expect(settings.anthropicModels).toEqual(["claude-custom"]);
  });

  it("creates independent default model lists for missing or invalid data", () => {
    const settings = loadSettings(null);
    settings.anthropicModels.push("custom");
    expect(DEFAULT_SETTINGS.anthropicModels).not.toContain("custom");
    expect(loadSettings({ maxContextChars: Infinity }).maxContextChars).toBe(DEFAULT_SETTINGS.maxContextChars);
  });
});

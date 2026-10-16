/** Values from JSON and host APIs stay unknown until their shape is checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function recordsOf(value: unknown): Record<string, unknown>[] {
  return arrayOf(value).filter(isRecord);
}

export function parseJson(text: string): unknown { return JSON.parse(text); }

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toolString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid provider tool call.");
  return value;
}

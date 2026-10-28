/** Values from JSON and host APIs stay unknown until their shape is checked. */
/** True when value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return value as a record, or {} when it is not one. */
export function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Return value as an array, or [] when it is not one. */
export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Filter an unknown into an array containing only records. */
export function recordsOf(value: unknown): Record<string, unknown>[] {
  return arrayOf(value).filter(isRecord);
}

/** Parse JSON, letting any syntax error propagate. */
export function parseJson(text: string): unknown { return JSON.parse(text); }

/** Render any value as a human-readable error message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coerce a tool argument to a string, throwing when it is not one. */
export function toolString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid provider tool call.");
  return value;
}

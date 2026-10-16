// Minimal stand-in for the `obsidian` module, used only by tests.
// Tests call mockRequestUrl() to control what requestUrl returns.

type ReqOpts = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
};

export type ReqUrlResponse = { status: number; json: any; text: string };

let impl: (opts: ReqOpts) => Promise<ReqUrlResponse> = async () => {
  throw new Error("requestUrl not mocked for this test");
};

export function mockRequestUrl(fn: (opts: ReqOpts) => Promise<ReqUrlResponse>) {
  impl = fn;
}

export function getRequestUrlCalls(): ReqOpts[] {
  return calls;
}

const calls: ReqOpts[] = [];

export async function requestUrl(opts: ReqOpts): Promise<ReqUrlResponse> {
  calls.push(opts);
  return impl(opts);
}

export function resetRequestUrlCalls() {
  calls.length = 0;
}

// Class shims so imports resolve. Tests pass plain objects cast as these.
export class App {}
export class TFile {}
export class TFolder {}
export class Modal {}
export class Notice {
  constructor(public message?: string) {}
}
export class Component {}
export const MarkdownRenderer = { render: async () => {} };
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");

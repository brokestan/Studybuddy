// A programmable global fetch for tests. Unmatched URLs THROW, so a test can
// never accidentally depend on a real network call (or on a provider the code
// was supposed to stay away from).

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any; // parsed JSON when the body was JSON, else the raw string
}
export type Handler = (call: Call) => Response | Promise<Response>;

export const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Server-sent-events body, like Groq/Gemini streaming: each chunk becomes one `data:` line. */
export const sseRes = (chunks: unknown[], opts: { done?: boolean } = {}) => {
  const enc = new TextEncoder();
  const lines = chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`);
  if (opts.done) lines.push("data: [DONE]\n\n");
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
};

/** A response that never arrives (until the caller's abort signal fires). */
export const hang = (signal?: AbortSignal | null): Promise<Response> =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
  });

function normHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

export function installFetch(routes: Array<[RegExp, Handler]>): { calls: Call[]; callsTo: (re: RegExp) => Call[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let body: any = init?.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { /* keep raw */ }
    }
    const call: Call = { url, method: init?.method ?? "GET", headers: normHeaders(init?.headers), body };
    calls.push(call);
    for (const [re, handler] of routes) {
      if (re.test(url)) {
        // Hand the abort signal to handlers that want to simulate a hang.
        (call as any).signal = init?.signal;
        return handler(call);
      }
    }
    throw new Error(`fakeFetch: unexpected request to ${url}`);
  }) as typeof fetch;
  return {
    calls,
    callsTo: (re) => calls.filter((c) => re.test(c.url)),
    restore: () => { globalThis.fetch = original; },
  };
}

// @mysten-incubation/memwal is ESM-only, but this project's tests run through
// tsx as CommonJS, so the real package can't be `require`d here (the existing
// tests never import lib/memory.ts for the same reason — they inject deps).
// To exercise the ROUTES, we intercept that one module and hand back a small
// in-memory stand-in with the same shape lib/memory.ts uses.
//
// Import this file FIRST in a test, before anything that imports lib/memory.
import Module from "node:module";

export interface FakeNote { blob_id: string; text: string; created_at: string }

class FakeWalrus {
  store = new Map<string, FakeNote[]>();
  private n = 0;
  /** Set to make every recall hang forever (a cold, unresponsive relayer). */
  hangRecall = false;

  reset() {
    this.store.clear();
    this.n = 0;
    this.hangRecall = false;
  }
  private add(ns: string, text: string): FakeNote {
    const note = { blob_id: `blob${++this.n}`, text, created_at: new Date(1_700_000_000_000 + this.n * 1000).toISOString() };
    this.store.set(ns, [...(this.store.get(ns) ?? []), note]);
    return note;
  }
  /** Test helper: what is stored in a namespace. */
  texts(ns: string): string[] {
    return (this.store.get(ns) ?? []).map((x) => x.text);
  }
  seed(ns: string, ...texts: string[]) {
    for (const t of texts) this.add(ns, t);
  }

  async remember(text: string, ns = "default") { this.add(ns, text); return {}; }
  async rememberAndWait(text: string, ns = "default") { return { blob_id: this.add(ns, text).blob_id }; }
  async analyze(text: string, ns = "default") {
    const n = this.add(ns, text);
    return { facts: [{ text, id: n.blob_id }] };
  }
  async recall(p: { query: string; namespace?: string; limit?: number; sort?: string }) {
    if (this.hangRecall) return new Promise<never>(() => {});
    let all = [...(this.store.get(p.namespace ?? "default") ?? [])];
    if (p.sort === "recent") all.reverse();
    return { results: all.slice(0, p.limit ?? 5).map((x) => ({ ...x, distance: 0.1 })) };
  }
  async listNamespaces() {
    return {
      namespaces: [...this.store].map(([name, arr]) => ({ id: name, name, memory_count: arr.length })),
      next_cursor: null,
      has_more: false,
    };
  }
  async health() { return { status: "ok" }; }
}

export const fakeWalrus = new FakeWalrus();

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "@mysten-incubation/memwal") {
    return { MemWal: { create: () => fakeWalrus }, MemWalMock: { create: () => fakeWalrus } };
  }
  return realLoad.call(this, request, ...rest);
};
process.env.MEMWAL_MOCK = "true"; // lib/memory.ts then uses the (fake) mock client

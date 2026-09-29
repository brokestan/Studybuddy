// Best-effort per-IP limiter. On serverless each instance has its own memory,
// so this is a speed bump against accidental floods (and to protect a free
// Groq quota and mainnet writes), not a hard security control.
interface Bucket { hits: number[] }
const g = globalThis as unknown as { __sbRate?: Map<string, Bucket> };
const store: Map<string, Bucket> = (g.__sbRate ??= new Map<string, Bucket>());

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const b = store.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    store.set(key, b);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - b.hits[0])) / 1000)) };
  }
  b.hits.push(now);
  store.set(key, b);
  if (store.size > 5000) for (const [k, v] of store) if (!v.hits.length || now - v.hits[v.hits.length - 1] > windowMs) store.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

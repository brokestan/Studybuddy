// Shared "is this model currently struggling?" memory for BOTH AI providers.
//
// Why it exists: free-tier models regularly answer 503 "high demand" or 429
// "rate limited" for a few minutes at a time. Once a model has just failed,
// every other student's request should skip it for a short while instead of
// each one paying the cost of failing first. This is that memory.
//
// Deliberately an in-process map, not a database: a cooldown is a few minutes
// of operational state, not something worth persisting (and Walrus is for
// what the tutor remembers about students, not for ops config).
//
// The map is process-wide on purpose (shared by every request on this server
// instance). The flip side is that it leaks between unit tests unless cleared,
// so tests call _resetForTests() in beforeEach.

export const COOLDOWN_MS = 3 * 60_000;

const g = globalThis as unknown as { __sbModelCooldown?: Map<string, number> };
const down: Map<string, number> = (g.__sbModelCooldown ??= new Map<string, number>());

/** "<provider>:<model>", e.g. "gemini:gemini-3-flash-preview". */
export const healthKey = (provider: string, model: string) => `${provider}:${model}`;

/** Put a model on cooldown (default ~3 minutes). `now` is injectable for tests. */
export function markDown(key: string, ms: number = COOLDOWN_MS, now: number = Date.now()): void {
  down.set(key, now + ms);
}

export function isDown(key: string, now: number = Date.now()): boolean {
  const until = down.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    down.delete(key); // expired: forget it so the map can't grow forever
    return false;
  }
  return true;
}

/**
 * Drops cooling-down candidates from `ids` (keys are `${prefix}:${id}`), but
 * NEVER returns an empty list: if everything is cooling down, we return the
 * original list and try them anyway. A model that is "probably still busy" is
 * a better bet than refusing to answer at all.
 */
export function filterHealthy(ids: string[], prefix: string, now: number = Date.now()): string[] {
  const healthy = ids.filter((id) => !isDown(healthKey(prefix, id), now));
  return healthy.length ? healthy : ids;
}

/** What is cooling down right now, and for how many more seconds (for the Status page). */
export function cooldownStatus(ids: string[], prefix: string, now: number = Date.now()): { model: string; secondsLeft: number }[] {
  const out: { model: string; secondsLeft: number }[] = [];
  for (const id of ids) {
    const until = down.get(healthKey(prefix, id));
    if (until !== undefined && until > now) out.push({ model: id, secondsLeft: Math.ceil((until - now) / 1000) });
  }
  return out;
}

/**
 * Tries each candidate in order until one works. Shared by the Groq and
 * Gemini clients so the fallback rules are identical (and tested once).
 *
 *  - `attempt(model)` does one full try on one model (including any
 *    per-model parameter retries) and either returns or throws.
 *  - If it throws something `shouldFallback` approves (retired / rate-limited
 *    / overloaded), that model goes on cooldown and the next one is tried.
 *  - Anything else (a genuine 400, a bad key...) is rethrown immediately —
 *    walking the list would only waste time on a request that cannot succeed.
 *  - Fallback stays INSIDE one provider. Crossing to the other provider would
 *    silently change which AI answered, which the model switcher exists to
 *    make visible.
 *  - `deadlineAt` stops us starting a fresh attempt when too little of the
 *    serverless time budget is left to finish it.
 */
export async function walkCandidates<T>(o: {
  provider: string;
  candidates: string[];
  attempt: (model: string) => Promise<T>;
  shouldFallback: (e: unknown) => boolean;
  onExhausted: (lastError: unknown, tried: string[]) => Error;
  deadlineAt?: number;
  minRemainingMs?: number;
}): Promise<{ value: T; model: string; tried: string[] }> {
  const order = filterHealthy(o.candidates, o.provider);
  const tried: string[] = [];
  let last: unknown;
  for (const model of order) {
    if (tried.length > 0 && o.deadlineAt !== undefined && o.deadlineAt - Date.now() < (o.minRemainingMs ?? 8_000)) break;
    tried.push(model);
    try {
      return { value: await o.attempt(model), model, tried };
    } catch (e) {
      if (!o.shouldFallback(e)) throw e;
      markDown(healthKey(o.provider, model));
      last = e;
    }
  }
  throw o.onExhausted(last, tried);
}

/** Test isolation only — clears every cooldown. */
export function _resetForTests(): void {
  down.clear();
}

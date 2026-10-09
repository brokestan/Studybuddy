import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { COOLDOWN_MS, _resetForTests, cooldownStatus, filterHealthy, healthKey, isDown, markDown, walkCandidates } from "@/lib/providerHealth";

// The cooldown map is deliberately process-wide, so it would leak between cases.
beforeEach(() => _resetForTests());

test("cooldown is about 3 minutes by default", () => {
  assert.equal(COOLDOWN_MS, 3 * 60_000);
});

test("markDown / isDown: down until the cooldown expires, then forgotten", () => {
  const t = 1_000_000;
  const k = healthKey("gemini", "gemini-3-flash-preview");
  assert.equal(isDown(k, t), false);
  markDown(k, COOLDOWN_MS, t);
  assert.equal(isDown(k, t + 1), true);
  assert.equal(isDown(k, t + COOLDOWN_MS - 1), true);
  assert.equal(isDown(k, t + COOLDOWN_MS), false); // expired exactly at the boundary
  assert.equal(isDown(k, t + 1), false); // and it was forgotten, not just ignored
});

test("cooldowns are scoped per provider AND per model", () => {
  const t = 5_000;
  markDown(healthKey("gemini", "shared-name"), 60_000, t);
  assert.equal(isDown(healthKey("gemini", "shared-name"), t + 1), true);
  assert.equal(isDown(healthKey("groq", "shared-name"), t + 1), false); // same model id, other provider
  assert.equal(isDown(healthKey("gemini", "another-model"), t + 1), false);
});

test("filterHealthy: drops cooling-down models, keeps order, only for the given provider", () => {
  const t = 10_000;
  markDown(healthKey("gemini", "b"), 60_000, t);
  markDown(healthKey("groq", "c"), 60_000, t);
  assert.deepEqual(filterHealthy(["a", "b", "c"], "gemini", t + 1), ["a", "c"]);
  assert.deepEqual(filterHealthy(["a", "b", "c"], "groq", t + 1), ["a", "b"]);
});

test("filterHealthy NEVER returns empty: if everything is cooling down it returns the original list", () => {
  const t = 10_000;
  for (const m of ["a", "b"]) markDown(healthKey("gemini", m), 60_000, t);
  assert.deepEqual(filterHealthy(["a", "b"], "gemini", t + 1), ["a", "b"]);
  assert.deepEqual(filterHealthy([], "gemini", t), []); // nothing in, nothing out — not an error
});

test("filterHealthy: a model that has finished cooling down is a candidate again", () => {
  const t = 10_000;
  markDown(healthKey("gemini", "a"), 1_000, t);
  assert.deepEqual(filterHealthy(["a", "b"], "gemini", t + 500), ["b"]);
  assert.deepEqual(filterHealthy(["a", "b"], "gemini", t + 1_500), ["a", "b"]);
});

test("cooldownStatus: reports what is down and how many whole seconds remain; omits expired ones", () => {
  const t = 100_000;
  markDown(healthKey("gemini", "a"), 90_000, t);
  markDown(healthKey("gemini", "b"), 5_000, t);
  markDown(healthKey("groq", "z"), 90_000, t);
  assert.deepEqual(cooldownStatus(["a", "b", "c"], "gemini", t + 1_000), [
    { model: "a", secondsLeft: 89 },
    { model: "b", secondsLeft: 4 },
  ]);
  assert.deepEqual(cooldownStatus(["a", "b", "c"], "gemini", t + 6_000), [{ model: "a", secondsLeft: 84 }]); // b expired
  assert.deepEqual(cooldownStatus(["z"], "gemini", t), []); // a groq cooldown is not a gemini one
});

test("_resetForTests clears every cooldown", () => {
  markDown(healthKey("gemini", "a"));
  assert.equal(isDown(healthKey("gemini", "a")), true);
  _resetForTests();
  assert.equal(isDown(healthKey("gemini", "a")), false);
});

// ---------- walkCandidates ----------
class Busy extends Error {}
const walk = (candidates: string[], attempt: (m: string) => Promise<string>, extra: Partial<Parameters<typeof walkCandidates<string>>[0]> = {}) =>
  walkCandidates<string>({
    provider: "gemini",
    candidates,
    attempt,
    shouldFallback: (e) => e instanceof Busy,
    onExhausted: (last, tried) => new Error(`exhausted after ${tried.join(",")}: ${(last as Error)?.message}`),
    ...extra,
  });

test("walkCandidates: first healthy candidate that works wins; later ones are never touched", async () => {
  const seen: string[] = [];
  const r = await walk(["a", "b"], async (m) => { seen.push(m); return `ok-${m}`; });
  assert.deepEqual(r, { value: "ok-a", model: "a", tried: ["a"] });
  assert.deepEqual(seen, ["a"]);
});

test("walkCandidates: an availability failure puts that model on cooldown and moves on", async () => {
  const r = await walk(["a", "b"], async (m) => { if (m === "a") throw new Busy("503"); return `ok-${m}`; });
  assert.equal(r.model, "b");
  assert.deepEqual(r.tried, ["a", "b"]);
  assert.equal(isDown(healthKey("gemini", "a")), true);
  assert.equal(isDown(healthKey("gemini", "b")), false);
});

test("walkCandidates: a genuine failure is rethrown immediately — no fallback walk, no cooldown", async () => {
  const seen: string[] = [];
  await assert.rejects(
    walk(["a", "b", "c"], async (m) => { seen.push(m); throw new TypeError("real 400"); }),
    /real 400/
  );
  assert.deepEqual(seen, ["a"]); // did not waste retries on b and c
  assert.equal(isDown(healthKey("gemini", "a")), false);
});

test("walkCandidates: skips models already cooling down, so the next request doesn't pay for the failure again", async () => {
  markDown(healthKey("gemini", "a"));
  const seen: string[] = [];
  await walk(["a", "b"], async (m) => { seen.push(m); return "ok"; });
  assert.deepEqual(seen, ["b"]);
});

test("walkCandidates: if everything is cooling down it still tries them all rather than refusing", async () => {
  markDown(healthKey("gemini", "a"));
  markDown(healthKey("gemini", "b"));
  const seen: string[] = [];
  const r = await walk(["a", "b"], async (m) => { seen.push(m); return `ok-${m}`; });
  assert.deepEqual(seen, ["a"]);
  assert.equal(r.model, "a");
});

test("walkCandidates: when every candidate fails it calls onExhausted with the last error and everything tried", async () => {
  await assert.rejects(
    walk(["a", "b"], async (m) => { throw new Busy(`busy-${m}`); }),
    /exhausted after a,b: busy-b/
  );
  assert.equal(isDown(healthKey("gemini", "a")), true);
  assert.equal(isDown(healthKey("gemini", "b")), true);
});

test("walkCandidates: stops starting new attempts when too little time is left (but always makes the first)", async () => {
  const seen: string[] = [];
  await assert.rejects(
    walk(["a", "b", "c"], async (m) => { seen.push(m); throw new Busy("busy"); }, { deadlineAt: Date.now() + 1_000, minRemainingMs: 8_000 }),
    /exhausted after a:/
  );
  assert.deepEqual(seen, ["a"]);
});

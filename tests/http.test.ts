import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "@/lib/http";
import { fetchTimed } from "@/lib/fetchTimed";
import { hang, installFetch, jsonRes } from "./helpers/fakeFetch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timers = () => process.getActiveResourcesInfo().filter((x) => x === "Timeout").length;

test("withTimeout: returns the real value when it settles in time", async () => {
  assert.equal(await withTimeout(sleep(5).then(() => "real"), 500, "fallback"), "real");
});

test("withTimeout: returns the fallback when the work is too slow", async () => {
  const t0 = Date.now();
  assert.equal(await withTimeout(new Promise<string>(() => {}), 40, "fallback"), "fallback");
  assert.ok(Date.now() - t0 < 1000);
});

test("withTimeout: a rejection becomes the fallback too (optional work must never take the request down)", async () => {
  assert.equal(await withTimeout(Promise.reject(new Error("boom")), 500, "fallback"), "fallback");
});

test("withTimeout: a late rejection after the timeout is swallowed (no unhandled rejection)", async () => {
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  try {
    const slowFail = sleep(60).then(() => { throw new Error("late failure"); });
    assert.equal(await withTimeout(slowFail, 10, "fallback"), "fallback");
    await sleep(120);
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("withTimeout: clears its timer once the work settles (nothing left holding the process open)", async () => {
  const before = timers();
  await withTimeout(Promise.resolve("done"), 60_000, "fallback");
  assert.equal(timers(), before);
});

test("fetchTimed: gives up on a server that never starts answering, after the SHORT header timeout", async () => {
  const fx = installFetch([[/./, (c) => hang((c as unknown as { signal?: AbortSignal }).signal)]]);
  try {
    const t0 = Date.now();
    await assert.rejects(fetchTimed("https://example.test/x", { method: "POST" }, 40, 5_000), /no response within/);
    assert.ok(Date.now() - t0 < 1000, "should abort at ~40ms, not wait for the long timeout");
  } finally {
    fx.restore();
  }
});

test("fetchTimed: the header timer is cleared as soon as headers arrive (a healthy slow stream is never cut off)", async () => {
  const fx = installFetch([[/./, () => jsonRes(200, { ok: true })]]);
  try {
    const before = timers();
    const res = await fetchTimed("https://example.test/x", {}, 60_000, 60_000);
    assert.equal(res.status, 200);
    assert.equal(timers(), before);
  } finally {
    fx.restore();
  }
});

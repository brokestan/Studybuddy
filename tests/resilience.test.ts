import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LlmError, chat, chatJson, chatWithModel, openStream, resolveCandidates, _resetModelCacheForTests } from "@/lib/llm";
import { chatGeminiWithModel, openGeminiStream, resolveGeminiCandidates, _resetGeminiCacheForTests } from "@/lib/gemini";
import { answerOnce, candidatesFor } from "@/lib/ai";
import { _resetForTests, cooldownStatus, healthKey, isDown, markDown } from "@/lib/providerHealth";
import { installFetch, jsonRes, sseRes, type Call, type Handler } from "./helpers/fakeFetch";

// ---------- fixtures ----------
const GROQ_LIVE = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "moonshotai/kimi-k2-instruct", "llama-3.1-8b-instant", "whisper-large-v3", "openai/gpt-oss-120b"];
const GEMINI_LIVE = ["models/gemini-3-flash-preview", "models/gemini-2.5-flash", "models/gemini-2.0-flash", "models/gemini-2.5-pro"];

// The literal payload from the bug report.
const GEMINI_503 = () =>
  jsonRes(503, { error: { code: 503, message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.", status: "UNAVAILABLE" } });
const geminiOk = (text: string) => jsonRes(200, { candidates: [{ content: { parts: [{ text }] } }] });
const groqOk = (text: string) => jsonRes(200, { choices: [{ message: { content: text } }] });
const err = (status: number, message: string) => jsonRes(status, { error: { message } });

const modelOf = (c: Call) => /\/models\/([^:]+):/.exec(c.url)![1];

function geminiRoutes(per: Record<string, Handler>, list = GEMINI_LIVE, listHandler?: Handler): Array<[RegExp, Handler]> {
  return [
    [/\/v1beta\/models$/, listHandler ?? (() => jsonRes(200, { models: list.map((name) => ({ name, supportedGenerationMethods: ["generateContent"] })) }))],
    [/\/models\/[^:]+:(stream)?[gG]enerateContent/, (c) => {
      const h = per[modelOf(c)];
      if (!h) throw new Error(`test has no handler for ${modelOf(c)}`);
      return h(c);
    }],
  ];
}
function groqRoutes(per: Record<string, Handler>, list = GROQ_LIVE, listHandler?: Handler): Array<[RegExp, Handler]> {
  return [
    [/api\.groq\.com\/openai\/v1\/models$/, listHandler ?? (() => jsonRes(200, { data: list.map((id) => ({ id })) }))],
    [/chat\/completions$/, (c) => {
      const h = per[c.body.model];
      if (!h) throw new Error(`test has no handler for ${c.body.model}`);
      return h(c);
    }],
  ];
}
const generateCalls = (fx: { callsTo: (r: RegExp) => Call[] }) => fx.callsTo(/:(stream)?[gG]enerateContent/).map(modelOf);
const groqChatCalls = (fx: { callsTo: (r: RegExp) => Call[] }) => fx.callsTo(/chat\/completions$/);

let fx: ReturnType<typeof installFetch> | undefined;
beforeEach(() => {
  process.env.GROQ_API_KEY = "test-groq-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.GROQ_MODEL;
  delete process.env.GEMINI_MODEL;
  _resetForTests();
  _resetModelCacheForTests();
  _resetGeminiCacheForTests();
});
afterEach(() => { fx?.restore(); fx = undefined; });

const MSGS = [{ role: "user" as const, content: "hi" }];

// =====================================================================
//  GEMINI
// =====================================================================

test("THE BUG REPORT: the literal Gemini 503 UNAVAILABLE on the top-ranked model falls through to the next model instead of erroring", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => GEMINI_503(),
    "gemini-2.5-flash": () => geminiOk("Here is your answer."),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));

  const r = await chatGeminiWithModel(MSGS);

  assert.deepEqual(r, { text: "Here is your answer.", model: "gemini-2.5-flash" });
  assert.deepEqual(generateCalls(fx), ["gemini-3-flash-preview", "gemini-2.5-flash"]); // tried the busy one first, then fell through
  assert.equal(isDown(healthKey("gemini", "gemini-3-flash-preview")), true); // and remembers it is busy
});

test("after a 503, the NEXT request skips the busy model entirely (cooldown), instead of failing on it again", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => GEMINI_503(),
    "gemini-2.5-flash": () => geminiOk("ok"),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  await chatGeminiWithModel(MSGS);
  await chatGeminiWithModel(MSGS);
  assert.deepEqual(generateCalls(fx), ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash"]);
});

test("once the cooldown has expired the model is tried again — and is used if it recovered", async () => {
  markDown(healthKey("gemini", "gemini-3-flash-preview"), 1_000, Date.now() - 5_000); // expired 4s ago
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => geminiOk("recovered"),
    "gemini-2.5-flash": () => geminiOk("fallback"),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  const r = await chatGeminiWithModel(MSGS);
  assert.equal(r.model, "gemini-3-flash-preview");
});

for (const [status, label] of [[404, "retired"], [429, "rate limited"], [500, "server error"], [502, "bad gateway"], [503, "overloaded"]] as const) {
  test(`Gemini ${status} (${label}) on the top model walks to the next candidate`, async () => {
    fx = installFetch(geminiRoutes({
      "gemini-3-flash-preview": () => err(status, "nope"),
      "gemini-2.5-flash": () => geminiOk("ok"),
    }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
    assert.equal((await chatGeminiWithModel(MSGS)).model, "gemini-2.5-flash");
  });
}

test("a genuine Gemini 400 (bad request) FAILS FAST: one call, no fallback walk, no cooldown", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => err(400, "Invalid JSON payload received. Unknown name \"foo\""),
    "gemini-2.5-flash": () => geminiOk("should never be reached"),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  await assert.rejects(chatGeminiWithModel(MSGS), (e: unknown) => e instanceof LlmError && e.status === 400 && e.fallbackWorthy === false);
  assert.deepEqual(generateCalls(fx), ["gemini-3-flash-preview"]);
  assert.equal(isDown(healthKey("gemini", "gemini-3-flash-preview")), false);
});

test("a 400 that says the MODEL is unknown IS treated as retired (and walks), unlike an invalid-key 400", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => err(400, "models/gemini-3-flash-preview is not supported for generateContent"),
    "gemini-2.5-flash": () => geminiOk("ok"),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  assert.equal((await chatGeminiWithModel(MSGS)).model, "gemini-2.5-flash");
});

test("when EVERY Gemini model is busy: the error names Gemini and suggests Groq — and Groq is NEVER silently used", async () => {
  fx = installFetch([
    ...geminiRoutes({
      "gemini-3-flash-preview": () => GEMINI_503(),
      "gemini-2.5-flash": () => GEMINI_503(),
      "gemini-2.0-flash": () => GEMINI_503(),
    }),
    // If the code ever crossed providers, this would answer — and the assertions below would catch it.
    ...groqRoutes({ "qwen/qwen3.8-27b": () => groqOk("sneaky groq answer") }),
  ]);
  await assert.rejects(chatGeminiWithModel(MSGS), (e: unknown) => {
    assert.ok(e instanceof LlmError);
    assert.match(e.message, /Gemini/);
    assert.match(e.message, /Groq/); // suggests switching
    assert.equal(e.fallbackWorthy, false); // exhausted: nothing left to try
    return true;
  });
  assert.equal(fx.callsTo(/api\.groq\.com/).length, 0);
  assert.equal(generateCalls(fx).length, 3); // tried all three eligible Flash models (pro is excluded)
});

test("every Gemini model rate limited (429) → a quota message, status 429", async () => {
  fx = installFetch(geminiRoutes({ "gemini-3-flash-preview": () => err(429, "quota"), "gemini-2.5-flash": () => err(429, "quota") }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  await assert.rejects(chatGeminiWithModel(MSGS), (e: unknown) => e instanceof LlmError && e.status === 429 && /Gemini/.test(e.message) && /quota/i.test(e.message));
});

test("a network failure on one Gemini model (fetch throws) also walks to the next", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => { throw new TypeError("fetch failed"); },
    "gemini-2.5-flash": () => geminiOk("ok"),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  assert.equal((await chatGeminiWithModel(MSGS)).model, "gemini-2.5-flash");
});

test("an EMPTY answer from a model counts as that model failing → next candidate", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => jsonRes(200, { candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "MAX_TOKENS" }] }),
    "gemini-2.5-flash": () => geminiOk("real answer"),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  assert.deepEqual(await chatGeminiWithModel(MSGS), { text: "real answer", model: "gemini-2.5-flash" });
});

test("a safety-filter refusal is NOT retried across models (they'd all refuse) and says so plainly", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => jsonRes(200, { promptFeedback: { blockReason: "SAFETY" } }),
    "gemini-2.5-flash": () => geminiOk("should not be reached"),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  await assert.rejects(chatGeminiWithModel(MSGS), (e: unknown) => e instanceof LlmError && e.status === 422 && /safety/i.test(e.message));
  assert.deepEqual(generateCalls(fx), ["gemini-3-flash-preview"]);
});

test("/models endpoint completely unreachable → falls back to ONE hardcoded last-resort model instead of crashing", async () => {
  fx = installFetch(geminiRoutes({ "gemini-2.5-flash": () => geminiOk("still working") }, GEMINI_LIVE, () => { throw new TypeError("fetch failed"); }));
  const c = await resolveGeminiCandidates();
  assert.deepEqual(c.models, ["gemini-2.5-flash"]);
  assert.equal(c.verified, false);
  assert.deepEqual(await chatGeminiWithModel(MSGS), { text: "still working", model: "gemini-2.5-flash" });
});

test("/models returning 500 is treated the same as unreachable; configured preferences come before the last resort", async () => {
  process.env.GEMINI_MODEL = "gemini-2.0-flash";
  fx = installFetch(geminiRoutes({}, GEMINI_LIVE, () => err(500, "backend error")));
  assert.deepEqual((await resolveGeminiCandidates()).models, ["gemini-2.0-flash", "gemini-2.5-flash"]);
});

test("a bad API key on /models is a real error, NOT silently papered over with the last-resort model", async () => {
  fx = installFetch(geminiRoutes({}, GEMINI_LIVE, () => err(400, "API key not valid. Please pass a valid API key.")));
  await assert.rejects(resolveGeminiCandidates(), (e: unknown) => e instanceof LlmError && e.status === 400);
});

test("GEMINI_MODEL is an ORDERED preference list: its live entries are tried first, in order, then the rest", async () => {
  process.env.GEMINI_MODEL = "gemini-2.0-flash, gemini-2.5-flash, gemini-1.0-flash-RETIRED";
  fx = installFetch(geminiRoutes({
    "gemini-2.0-flash": () => GEMINI_503(),
    "gemini-2.5-flash": () => geminiOk("second preference answered"),
  }));
  const r = await chatGeminiWithModel(MSGS);
  assert.equal(r.model, "gemini-2.5-flash");
  assert.deepEqual(generateCalls(fx), ["gemini-2.0-flash", "gemini-2.5-flash"]); // preview (auto-ranked first) is NOT ahead of the developer's choices
});

test("the Gemini API key is sent in a header, never in the URL", async () => {
  fx = installFetch(geminiRoutes({ "gemini-3-flash-preview": () => geminiOk("ok") }, ["models/gemini-3-flash-preview"]));
  await chatGeminiWithModel(MSGS);
  assert.ok(fx.calls.length >= 2);
  for (const c of fx.calls) {
    assert.equal(c.headers["x-goog-api-key"], "test-gemini-key");
    assert.ok(!c.url.includes("test-gemini-key") && !/[?&]key=/.test(c.url), c.url);
  }
});

test("Gemini gets thinking-token headroom on top of the visible-answer budget (so short caps can't truncate to nothing)", async () => {
  fx = installFetch(geminiRoutes({ "gemini-3-flash-preview": () => geminiOk("ok") }, ["models/gemini-3-flash-preview"]));
  await chatGeminiWithModel(MSGS, { maxTokens: 500 });
  assert.equal(fx.callsTo(/generateContent/)[0].body.generationConfig.maxOutputTokens, 1500);
});

const sseText = (t: string) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });

test("streaming: a 503 on the top model before the first token falls through, and reports which model really answered", async () => {
  fx = installFetch(geminiRoutes({
    "gemini-3-flash-preview": () => GEMINI_503(),
    "gemini-2.5-flash": () => sseRes([sseText("Hel"), sseText("lo "), sseText("there")]),
  }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]));
  const { model, stream } = await openGeminiStream(MSGS);
  let out = "";
  for await (const t of stream) out += t;
  assert.equal(model, "gemini-2.5-flash");
  assert.equal(out, "Hello there");
  assert.ok(fx.callsTo(/streamGenerateContent\?alt=sse$/).length === 2);
});

// =====================================================================
//  GROQ
// =====================================================================

test("Groq: a parameter rejection (reasoning_effort) is retried on the SAME model without that parameter — it does not walk the list", async () => {
  let n = 0;
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => (++n === 1 ? err(400, "reasoning_effort is not supported with this model") : groqOk("fine")),
    "qwen/qwen3.6-27b": () => groqOk("should not be reached"),
  }));
  const r = await chatWithModel(MSGS);
  assert.deepEqual(r, { text: "fine", model: "qwen/qwen3.8-27b" });
  const calls = groqChatCalls(fx);
  assert.deepEqual(calls.map((c) => c.body.model), ["qwen/qwen3.8-27b", "qwen/qwen3.8-27b"]);
  assert.equal(calls[0].body.reasoning_effort, "none");
  assert.equal("reasoning_effort" in calls[1].body, false);
  assert.equal(isDown(healthKey("groq", "qwen/qwen3.8-27b")), false); // a parameter quirk is not an outage
});

test("Groq: JSON mode rejected → retried on the same model without response_format", async () => {
  let n = 0;
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => (++n === 1 ? err(400, "response_format json_object is not supported") : groqOk('{"a":1}')),
  }));
  assert.deepEqual(await chatJson(MSGS, (t) => JSON.parse(t)), { a: 1 });
  const calls = groqChatCalls(fx);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.response_format);
  assert.equal("response_format" in calls[1].body, false);
});

test("Groq: a 503 walks to the NEXT model (availability layer), without any parameter retry on the failing one", async () => {
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => err(503, "over capacity"),
    "qwen/qwen3.6-27b": () => groqOk("from the next model"),
  }));
  const r = await chatWithModel(MSGS);
  assert.deepEqual(r, { text: "from the next model", model: "qwen/qwen3.6-27b" });
  assert.deepEqual(groqChatCalls(fx).map((c) => c.body.model), ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b"]);
  assert.equal(isDown(healthKey("groq", "qwen/qwen3.8-27b")), true);
});

test("Groq: both layers together — a parameter retry on model A, then A turns out overloaded, then model B answers", async () => {
  let a = 0;
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => (++a === 1 ? err(400, "reasoning_effort unsupported") : err(503, "busy")),
    "qwen/qwen3.6-27b": () => groqOk("B answered"),
  }));
  assert.equal((await chatWithModel(MSGS)).model, "qwen/qwen3.6-27b");
  assert.deepEqual(groqChatCalls(fx).map((c) => c.body.model), ["qwen/qwen3.8-27b", "qwen/qwen3.8-27b", "qwen/qwen3.6-27b"]);
});

test("Groq: a model retired with a 400 'decommissioned' body (not a 404) still walks on", async () => {
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => err(400, "The model `qwen/qwen3.8-27b` has been decommissioned and is no longer supported."),
    "qwen/qwen3.6-27b": () => groqOk("ok"),
  }));
  assert.equal((await chatWithModel(MSGS)).model, "qwen/qwen3.6-27b");
});

test("Groq: a genuine 400 (e.g. context too long) FAILS FAST — no fallback walk", async () => {
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => err(400, "Please reduce the length of the messages or completion."),
    "qwen/qwen3.6-27b": () => groqOk("should not be reached"),
  }));
  await assert.rejects(chat(MSGS), (e: unknown) => e instanceof LlmError && e.status === 400 && !e.fallbackWorthy);
  assert.equal(groqChatCalls(fx).length, 1);
});

test("Groq: every model rate limited → the friendly quota message, status 429", async () => {
  fx = installFetch(groqRoutes(Object.fromEntries(["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "moonshotai/kimi-k2-instruct", "llama-3.1-8b-instant"].map((m) => [m, () => err(429, "rate")]))));
  await assert.rejects(chat(MSGS), (e: unknown) => e instanceof LlmError && e.status === 429 && /try again in a few seconds/i.test(e.message));
  assert.equal(groqChatCalls(fx).length, 4); // all four eligible models were tried (whisper and gpt-oss are excluded)
});

test("Groq: a network failure on one model walks to the next", async () => {
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => { throw new TypeError("fetch failed"); },
    "qwen/qwen3.6-27b": () => groqOk("ok"),
  }));
  assert.equal((await chatWithModel(MSGS)).model, "qwen/qwen3.6-27b");
});

test("Groq: a reasoning-only reply that is empty once <think> is stripped counts as a failed model", async () => {
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => groqOk("<think>hmm hmm</think>"),
    "qwen/qwen3.6-27b": () => groqOk("real answer"),
  }));
  assert.deepEqual(await chatWithModel(MSGS), { text: "real answer", model: "qwen/qwen3.6-27b" });
});

test("Groq: /models completely unreachable → ONE hardcoded last-resort model, not a crash", async () => {
  fx = installFetch(groqRoutes({ "qwen/qwen3.8-27b": () => groqOk("alive") }, GROQ_LIVE, () => { throw new TypeError("fetch failed"); }));
  const c = await resolveCandidates();
  assert.deepEqual(c.models, ["qwen/qwen3.8-27b"]);
  assert.equal(c.verified, false);
  assert.equal(await chat(MSGS), "alive");
});

test("Groq: a bad key on /models is a real error, not hidden by the fallback", async () => {
  fx = installFetch(groqRoutes({}, GROQ_LIVE, () => err(401, "Invalid API Key")));
  await assert.rejects(resolveCandidates(), (e: unknown) => e instanceof LlmError && e.status === 401);
});

test("Groq: a missing key fails loudly with a clear message", async () => {
  delete process.env.GROQ_API_KEY;
  fx = installFetch([]);
  await assert.rejects(chat(MSGS), /GROQ_API_KEY is not set/);
});

test("GROQ_MODEL is an ordered preference list, tried first in the order given", async () => {
  process.env.GROQ_MODEL = "llama-3.1-8b-instant,qwen/qwen3.6-27b";
  fx = installFetch(groqRoutes({
    "llama-3.1-8b-instant": () => err(503, "busy"),
    "qwen/qwen3.6-27b": () => groqOk("second preference"),
  }));
  assert.equal((await chatWithModel(MSGS)).model, "qwen/qwen3.6-27b");
  assert.deepEqual(groqChatCalls(fx).map((c) => c.body.model), ["llama-3.1-8b-instant", "qwen/qwen3.6-27b"]);
  // and a non-live preference never gets sent
  assert.ok(!(await resolveCandidates()).models.includes("nonexistent"));
});

test("Groq streaming: 503 before the first token falls through; the right model is reported; <think> is filtered", async () => {
  fx = installFetch(groqRoutes({
    "qwen/qwen3.8-27b": () => err(503, "busy"),
    "qwen/qwen3.6-27b": () => sseRes([{ choices: [{ delta: { content: "<think>x</think>Hi " } }] }, { choices: [{ delta: { content: "there" } }] }], { done: true }),
  }));
  const { model, stream } = await openStream(MSGS);
  let out = "";
  for await (const t of stream) out += t;
  assert.equal(model, "qwen/qwen3.6-27b");
  assert.equal(out, "Hi there");
});

// =====================================================================
//  ai.ts dispatcher
// =====================================================================

test("answerOnce: routes to the chosen provider only, and reports the model that answered", async () => {
  fx = installFetch([
    ...geminiRoutes({ "gemini-3-flash-preview": () => GEMINI_503(), "gemini-2.5-flash": () => geminiOk("from gemini") }, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"]),
    ...groqRoutes({ "qwen/qwen3.8-27b": () => groqOk("from groq") }),
  ]);
  assert.deepEqual(await answerOnce("gemini", MSGS), { text: "from gemini", model: "gemini-2.5-flash" });
  assert.equal(fx.callsTo(/api\.groq\.com/).length, 0);
  assert.deepEqual(await answerOnce("groq", MSGS), { text: "from groq", model: "qwen/qwen3.8-27b" });
});

test("candidatesFor: shows the full ranked order, what is cooling down (with seconds left), and what is tried first right now", async () => {
  fx = installFetch(geminiRoutes({}, ["models/gemini-3-flash-preview", "models/gemini-2.5-flash", "models/gemini-2.0-flash"]));
  markDown(healthKey("gemini", "gemini-3-flash-preview"));
  const v = await candidatesFor("gemini");
  assert.deepEqual(v.ranked, ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"]);
  assert.deepEqual(v.tryOrder, ["gemini-2.5-flash", "gemini-2.0-flash"]);
  assert.equal(v.cooling.length, 1);
  assert.equal(v.cooling[0].model, "gemini-3-flash-preview");
  assert.ok(v.cooling[0].secondsLeft > 170 && v.cooling[0].secondsLeft <= 180);
  assert.equal(v.verified, true);
  assert.deepEqual(cooldownStatus(v.ranked, "groq"), []); // gemini's trouble is not groq's
});

test("candidatesFor: if EVERY model is cooling down, tryOrder is still the full list (never empty)", async () => {
  fx = installFetch(geminiRoutes({}, ["models/gemini-2.5-flash", "models/gemini-2.0-flash"]));
  markDown(healthKey("gemini", "gemini-2.5-flash"));
  markDown(healthKey("gemini", "gemini-2.0-flash"));
  const v = await candidatesFor("gemini");
  assert.deepEqual(v.tryOrder, v.ranked);
  assert.equal(v.cooling.length, 2);
});

// Route-level tests: the real route handlers, a fake in-memory Walrus, and a mocked fetch for
// Groq / Gemini / Supabase. Import the Walrus fake FIRST (see helpers/fakeMemwal.ts).
import { fakeWalrus } from "./helpers/fakeMemwal";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installFetch, jsonRes, sseRes, type Call, type Handler } from "./helpers/fakeFetch";
import { _resetModelCacheForTests } from "@/lib/llm";
import { _resetGeminiCacheForTests } from "@/lib/gemini";
import { _resetForTests, healthKey, markDown } from "@/lib/providerHealth";
import { privateNamespace, roomNamespace } from "@/lib/identity";

const SAM = "sam-secret-code-1111";
const ROOM = "room-abcd-efgh";
const GROQ_LIVE = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b"];
const GEMINI_LIVE = ["models/gemini-3-flash-preview", "models/gemini-2.5-flash"];

const GEMINI_503 = () => jsonRes(503, { error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } });
const geminiOk = (text: string) => jsonRes(200, { candidates: [{ content: { parts: [{ text }] } }] });
const groqOk = (text: string) => jsonRes(200, { choices: [{ message: { content: text } }] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const modelOf = (c: Call) => /\/models\/([^:]+):/.exec(c.url)![1];

function routes(opts: {
  groq?: Handler | null; // null = Groq must not be called at all
  gemini?: Record<string, Handler> | null;
  supabase?: Handler;
} = {}): Array<[RegExp, Handler]> {
  const r: Array<[RegExp, Handler]> = [
    [/example\.supabase\.co\/realtime\/v1\/api\/broadcast/, opts.supabase ?? (() => jsonRes(202, {}))],
  ];
  if (opts.groq !== null) {
    const groq: Handler = opts.groq ?? ((c) => groqOk(c.body.response_format ? '{"subject":"History","topic":"French Revolution"}' : "Hello from Groq"));
    r.push([/api\.groq\.com\/openai\/v1\/models$/, () => jsonRes(200, { data: GROQ_LIVE.map((id) => ({ id })) })]);
    r.push([/api\.groq\.com\/openai\/v1\/chat\/completions$/, groq]);
  }
  if (opts.gemini) {
    const per = opts.gemini;
    r.push([/\/v1beta\/models$/, () => jsonRes(200, { models: GEMINI_LIVE.map((name) => ({ name, supportedGenerationMethods: ["generateContent"] })) })]);
    r.push([/\/models\/[^:]+:(stream)?[gG]enerateContent/, (c) => per[modelOf(c)](c)]);
  }
  return r;
}

let fx: ReturnType<typeof installFetch> | undefined;
beforeEach(() => {
  Object.assign(process.env, {
    GROQ_API_KEY: "test-groq", GEMINI_API_KEY: "test-gemini",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    RECALL_TIMEOUT_MS: "40", OPENER_LLM_TIMEOUT_MS: "40",
  });
  delete process.env.ENABLE_DEV_TESTS;
  delete process.env.GROQ_MODEL;
  delete process.env.GEMINI_MODEL;
  fakeWalrus.reset();
  _resetForTests(); _resetModelCacheForTests(); _resetGeminiCacheForTests();
});
afterEach(() => { fx?.restore(); fx = undefined; });

const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const roomBody = (over: Record<string, unknown> = {}) => ({ roomId: ROOM, code: SAM, name: "Sam", content: "Can someone explain the chain rule please?", askBuddy: true, ...over });
const broadcastPayloads = () => fx!.callsTo(/broadcast/).flatMap((c) => c.body.messages.map((m: { payload: Record<string, unknown> }) => m.payload));

// =====================================================================
//  Study Room: provider toggle
// =====================================================================

test("room: provider 'gemini' is used (with within-Gemini fallback), and the model that ANSWERED is returned to the sender", async () => {
  fx = installFetch(routes({ groq: null, gemini: { "gemini-3-flash-preview": GEMINI_503, "gemini-2.5-flash": () => geminiOk("The chain rule says differentiate the outer, then the inner.") } }));
  const { POST } = await import("@/app/api/room/message/route");
  const res = await POST(post("/api/room/message", roomBody({ provider: "gemini" })));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.provider, "gemini");
  assert.equal(data.model, "gemini-2.5-flash"); // not the preview model that was busy
  assert.equal(fx.callsTo(/api\.groq\.com/).length, 0); // Groq untouched
});

test("room: 'answered via' stays sender-only — the broadcast payloads never mention provider or model", async () => {
  fx = installFetch(routes({ groq: null, gemini: { "gemini-3-flash-preview": () => geminiOk("Here you go."), "gemini-2.5-flash": () => geminiOk("x") } }));
  const { POST } = await import("@/app/api/room/message/route");
  await POST(post("/api/room/message", roomBody({ provider: "gemini" })));
  const payloads = broadcastPayloads();
  assert.equal(payloads.length, 2); // the student's line + Buddy's reply
  for (const p of payloads) {
    assert.ok(!("provider" in p) && !("model" in p), JSON.stringify(p));
    assert.ok(!JSON.stringify(p).includes("gemini"));
  }
});

test("room: provider defaults to Groq when the client doesn't send one (older clients keep working)", async () => {
  fx = installFetch(routes({ gemini: null }));
  const { POST } = await import("@/app/api/room/message/route");
  const data = await (await POST(post("/api/room/message", roomBody()))).json();
  assert.equal(data.provider, "groq");
  assert.equal(data.model, "qwen/qwen3.8-27b");
});

test("room: an unknown provider is rejected by validation", async () => {
  fx = installFetch(routes());
  const { POST } = await import("@/app/api/room/message/route");
  const res = await POST(post("/api/room/message", roomBody({ provider: "claude" })));
  assert.equal(res.status, 400);
});

test("room: a plain Send (no Ask Buddy) makes no AI call at all, so no model is reported", async () => {
  fx = installFetch(routes({ groq: null, gemini: {} }));
  const { POST } = await import("@/app/api/room/message/route");
  const data = await (await POST(post("/api/room/message", roomBody({ askBuddy: false, provider: "gemini" })))).json();
  assert.equal(data.model, null);
  assert.equal(fx.callsTo(/generateContent/).length, 0);
});

test("room: every Gemini model busy → clear Gemini error; the student's line is kept in room history; message flagged as posted; Groq never used", async () => {
  fx = installFetch(routes({ groq: null, gemini: { "gemini-3-flash-preview": GEMINI_503, "gemini-2.5-flash": GEMINI_503 } }));
  const { POST } = await import("@/app/api/room/message/route");
  const res = await POST(post("/api/room/message", roomBody({ provider: "gemini" })));
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.match(data.error, /Gemini/);
  assert.match(data.error, /Groq/);
  assert.equal(data.posted, true); // the client must NOT hand the draft back for re-sending
  assert.equal(fx.callsTo(/api\.groq\.com/).length, 0);
  // the line is live in the room, so it must also be in the durable room history — exactly once, and no fake Buddy reply
  const room = fakeWalrus.texts(roomNamespace(ROOM));
  assert.equal(room.length, 1);
  assert.match(room[0], /chain rule/);
});

test("room: if the student's line never reached the room (live channel down), the failure says posted:false and nothing is saved", async () => {
  fx = installFetch(routes({ gemini: null, supabase: () => jsonRes(500, { message: "down" }) }));
  const { POST } = await import("@/app/api/room/message/route");
  const res = await POST(post("/api/room/message", roomBody()));
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal(data.posted, false); // safe for the client to restore the draft
  assert.deepEqual(fakeWalrus.texts(roomNamespace(ROOM)), []);
});

// =====================================================================
//  Tutor opener: no endless "checking what Walrus remembers"
// =====================================================================

test("opener: a hung Walrus recall no longer hangs the request — it answers within the timeout with an honest 'couldn't reach memory' greeting", async () => {
  fx = installFetch(routes({ gemini: null }));
  fakeWalrus.hangRecall = true;
  const { POST } = await import("@/app/api/tutor/open/route");
  const t0 = Date.now();
  const data = await (await POST(post("/api/tutor/open", { code: SAM, name: "Sam" }))).json();
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
  assert.equal(data.memoryOk, false);
  assert.equal(data.returning, false);
  assert.match(data.greeting, /couldn't reach your Walrus memory/);
  assert.doesNotMatch(data.greeting, /remember it on Walrus/); // must not promise memory it can't deliver, or claim a first visit
  assert.equal(data.suggestions.length, 3);
});

test("opener: a slow opener-LLM falls back to the plain welcome-back greeting and STILL shows the student's real notes", async () => {
  fakeWalrus.seed(privateNamespace(SAM), "Sam is preparing for the SAT in June");
  fx = installFetch(routes({ gemini: null, groq: async () => { await sleep(300); return groqOk('{"greeting":"too late","suggestions":["a b","c d","e f"]}'); } }));
  const { POST } = await import("@/app/api/tutor/open/route");
  const t0 = Date.now();
  const data = await (await POST(post("/api/tutor/open", { code: SAM, name: "Sam" }))).json();
  assert.ok(Date.now() - t0 < 250, `took ${Date.now() - t0}ms`);
  assert.equal(data.returning, true);
  assert.equal(data.memoryOk, true);
  assert.match(data.greeting, /Welcome back, Sam/);
  assert.equal(data.notes.length, 1);
  assert.match(data.notes[0].text, /SAT/);
});

test("opener: the normal path is unchanged — a returning student gets the model-written greeting", async () => {
  process.env.OPENER_LLM_TIMEOUT_MS = "5000";
  fakeWalrus.seed(privateNamespace(SAM), "Sam is preparing for the SAT in June");
  fx = installFetch(routes({ gemini: null, groq: () => groqOk('{"greeting":"Welcome back Sam — ready for more SAT prep?","suggestions":["Practice math","Review reading","Quiz me"]}') }));
  const { POST } = await import("@/app/api/tutor/open/route");
  const data = await (await POST(post("/api/tutor/open", { code: SAM, name: "Sam" }))).json();
  assert.match(data.greeting, /SAT prep/);
  assert.equal(data.returning, true);
});

test("opener: a brand-new student with healthy memory still gets the first-visit greeting", async () => {
  fx = installFetch(routes({ gemini: null }));
  const { POST } = await import("@/app/api/tutor/open/route");
  const data = await (await POST(post("/api/tutor/open", { code: "brand-new-code-9999", name: "Pat" }))).json();
  assert.equal(data.returning, false);
  assert.equal(data.memoryOk, true);
  assert.match(data.greeting, /I'm Study Buddy/);
});

// =====================================================================
//  Main tutor route
// =====================================================================

async function readEvents(res: Response): Promise<Array<Record<string, any>>> {
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("tutor: Walrus recall hangs → answers anyway after the timeout; the stream reports which Gemini model REALLY answered after a 503 fallback", async () => {
  fakeWalrus.hangRecall = true;
  fx = installFetch(routes({
    gemini: {
      "gemini-3-flash-preview": GEMINI_503,
      "gemini-2.5-flash": () => sseRes([{ candidates: [{ content: { parts: [{ text: "Hello " }] } }] }, { candidates: [{ content: { parts: [{ text: "there" }] } }] }]),
    },
  }));
  const { POST } = await import("@/app/api/tutor/route");
  const t0 = Date.now();
  const res = await POST(post("/api/tutor", { code: SAM, name: "Sam", message: "quiz me on the french revolution", provider: "gemini" }));
  const ev = await readEvents(res);
  assert.ok(Date.now() - t0 < 3000);

  const meta = ev.find((e) => e.type === "meta")!;
  assert.equal(meta.memoryOk, false); // recall timed out → UI shows "memory unreachable"
  const model = ev.find((e) => e.type === "model")!;
  assert.equal(model.provider, "gemini");
  assert.equal(model.model, "Gemini · gemini-2.5-flash");
  assert.equal(ev.filter((e) => e.type === "token").map((e) => e.t).join(""), "Hello there");
  assert.ok(ev.some((e) => e.type === "done"));
  assert.ok(!ev.some((e) => e.type === "error"));
  // order matters to the UI: the corrected model label must arrive before the first token
  assert.ok(ev.findIndex((e) => e.type === "model") < ev.findIndex((e) => e.type === "token"));
});

test("tutor: with Gemini fully down the stream ends with an error naming Gemini (and nothing is silently answered by Groq)", async () => {
  fx = installFetch(routes({ gemini: { "gemini-3-flash-preview": GEMINI_503, "gemini-2.5-flash": GEMINI_503 }, groq: null }));
  const { POST } = await import("@/app/api/tutor/route");
  const ev = await readEvents(await POST(post("/api/tutor", { code: SAM, name: "Sam", message: "quiz me on the french revolution", provider: "gemini" })));
  const e = ev.find((x) => x.type === "error")!;
  assert.match(e.message, /Gemini/);
  assert.match(e.message, /Groq/);
  assert.ok(!ev.some((x) => x.type === "token"));
  assert.equal(fx.callsTo(/api\.groq\.com/).length, 0);
});

test("tutor: Groq still works end to end, and memory is written regardless of provider", async () => {
  fx = installFetch(routes({ gemini: null, groq: (c) => (c.body.stream ? sseRes([{ choices: [{ delta: { content: "Ok!" } }] }], { done: true }) : groqOk(c.body.response_format ? '{"subject":"History","topic":"French Revolution"}' : "x")) }));
  const { POST } = await import("@/app/api/tutor/route");
  const ev = await readEvents(await POST(post("/api/tutor", { code: SAM, name: "Sam", message: "quiz me on the french revolution please", provider: "groq" })));
  assert.equal(ev.find((e) => e.type === "model")!.model, "Groq · qwen/qwen3.8-27b");
  assert.ok(ev.some((e) => e.type === "done"));
  assert.ok(fakeWalrus.texts(privateNamespace(SAM)).some((t) => /french revolution/i.test(t)));
});

// =====================================================================
//  Status page API
// =====================================================================

async function status() {
  const { GET } = await import("@/app/api/status/route");
  return (await GET(new Request("http://localhost/api/status"))).json();
}

test("status: shows each provider's full fallback order and what is cooling down", async () => {
  fx = installFetch(routes({ gemini: {} }));
  markDown(healthKey("gemini", "gemini-3-flash-preview"));
  const s = await status();
  assert.deepEqual(s.gemini.candidates.ranked, ["gemini-3-flash-preview", "gemini-2.5-flash"]);
  assert.equal(s.gemini.model, "gemini-2.5-flash"); // what would be tried first right now
  assert.equal(s.gemini.candidates.cooling[0].model, "gemini-3-flash-preview");
  assert.ok(s.gemini.candidates.cooling[0].secondsLeft > 0);
  assert.deepEqual(s.llm.candidates.ranked, GROQ_LIVE);
  assert.equal(s.usage, undefined); // usage counts are dev-only
});

test("status: usage counts keys and rooms — and NEVER reveals a key, a room code or a namespace name", async () => {
  process.env.ENABLE_DEV_TESTS = "true";
  const aKey = privateNamespace("alex-secret-code-2222");
  fakeWalrus.seed(privateNamespace(SAM), "a", "b", "c");
  fakeWalrus.seed(aKey, "d");
  fakeWalrus.seed(roomNamespace(ROOM), "e", "f");
  fakeWalrus.seed("studybuddy-default", "g");
  fx = installFetch(routes({ gemini: {} }));
  const s = await status();
  assert.deepEqual(
    { ...s.usage },
    { ok: true, privateProfiles: 2, studyRooms: 1, other: 1, privateMemories: 4, roomMemories: 2, truncated: false }
  );
  const dump = JSON.stringify(s);
  for (const secret of [SAM, "alex-secret-code-2222", ROOM, privateNamespace(SAM), aKey, "sb-u-", "sb-r-"]) {
    assert.ok(!dump.includes(secret), `status response leaked ${secret}`);
  }
});

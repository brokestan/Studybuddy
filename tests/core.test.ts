import { test } from "node:test";
import assert from "node:assert/strict";
import { pickModel, isEligibleChatModel, supportsReasoningNone } from "@/lib/modelPicker";
import { ThinkFilter, parseSSEStream } from "@/lib/sse";
import { shouldGround, parseSearch, parseSummary, groundOn } from "@/lib/wiki";
import { rateLimit } from "@/lib/rateLimit";
import { parseQuiz, parseCards, shuffleQuiz, extractJson } from "@/lib/quizJson";
import { summarizeQuiz, summarizeCards, tutorSystemPrompt } from "@/lib/prompts";

test("modelPicker: prefers configured id when available", () => {
  assert.equal(pickModel(["qwen/qwen3.8-27b", "llama-3.1-8b-instant"], ["qwen/qwen3.8-27b"]), "qwen/qwen3.8-27b");
});
test("modelPicker: survives a retirement by picking the newest eligible Qwen", () => {
  const live = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "llama-3.1-8b-instant", "whisper-large-v3", "openai/gpt-oss-120b", "groq/compound"];
  assert.equal(pickModel(live, ["qwen/qwen3.6-27b-RETIRED"]), "qwen/qwen3.8-27b");
});
test("modelPicker: never selects OpenAI-made, guard, speech or compound models", () => {
  assert.equal(pickModel(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]), null);
  for (const bad of ["whisper-large-v3", "meta-llama/llama-guard-4-12b", "openai/gpt-oss-safeguard-20b", "canopylabs/orpheus-v1-english", "groq/compound"])
    assert.equal(isEligibleChatModel(bad), false, bad);
  assert.equal(pickModel(["meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.1-8b-instant", "meta-llama/llama-guard-4-12b"]), "meta-llama/llama-4-scout-17b-16e-instruct");
});
test("modelPicker: reasoning_effort=none only for Qwen 3.6+", () => {
  assert.equal(supportsReasoningNone("qwen/qwen3.8-27b"), true);
  assert.equal(supportsReasoningNone("llama-3.1-8b-instant"), false);
});

test("ThinkFilter strips <think> blocks even when split across chunks", () => {
  const f = new ThinkFilter();
  let out = "";
  for (const c of ["Hello <th", "ink>secret reason", "ing</th", "ink> world", "!"]) out += f.push(c);
  out += f.flush();
  assert.equal(out, "Hello  world!");
});
test("ThinkFilter passes normal text and stray '<' through", () => {
  const f = new ThinkFilter();
  let out = f.push("if a < b then ") + f.push("done") + f.flush();
  assert.equal(out, "if a < b then done");
});

test("parseSSEStream handles split lines and multiple lines per chunk", async () => {
  const enc = new TextEncoder();
  const chunks = ['data: {"a":1}\n\ndata: {"a"', ':2}\n\ndata: [DONE]\n\n'];
  const body = new ReadableStream<Uint8Array>({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
  const got: string[] = [];
  for await (const l of parseSSEStream(body)) got.push(l);
  assert.deepEqual(got, ['{"a":1}', '{"a":2}', "[DONE]"]);
});

test("wiki: shouldGround only for knowledge questions", () => {
  assert.equal(shouldGround("Why is the sky blue?"), true);
  assert.equal(shouldGround("explain how mitochondria produce ATP"), true);
  assert.equal(shouldGround("quiz me on the french revolution"), false);
  assert.equal(shouldGround("hi"), false);
  assert.equal(shouldGround("what are my weak spots"), false);
});
test("wiki: parses search + summary payloads, rejects junk", () => {
  assert.deepEqual(parseSearch({ query: { search: [{ title: "Rayleigh scattering" }, { title: "Sky" }, { title: "x" }] } }), ["Rayleigh scattering", "Sky"]);
  assert.deepEqual(parseSearch({}), []);
  const s = parseSummary({ title: "Rayleigh scattering", extract: "Rayleigh scattering is the scattering of light by particles much smaller than the wavelength.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Rayleigh_scattering" } } });
  assert.equal(s?.url, "https://en.wikipedia.org/wiki/Rayleigh_scattering");
  assert.equal(parseSummary({ title: "x", extract: "short" }), null);
});
test("wiki: network failure returns [] (never throws)", async () => {
  process.env.WIKI_BASE = "http://127.0.0.1:1"; // nothing listens here
  assert.deepEqual(await groundOn("why is the sky blue", 500), []);
  delete process.env.WIKI_BASE;
});

test("rateLimit: allows up to the limit then blocks, then recovers", () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit("k1", 3, 1000, t + i).ok, true);
  assert.equal(rateLimit("k1", 3, 1000, t + 5).ok, false);
  assert.equal(rateLimit("k1", 3, 1000, t + 2000).ok, true);
  assert.equal(rateLimit("other", 3, 1000, t).ok, true);
});

const goodQuiz = { title: "Cells", questions: [
  { q: "What organelle produces most ATP?", options: ["Nucleus", "Mitochondrion", "Ribosome", "Golgi"], answerIndex: 1, explanation: "Mitochondria run oxidative phosphorylation.", concept: "Cell energy" },
] };
test("quiz: extracts JSON from fenced/prosey output and validates", () => {
  const q = parseQuiz("Sure! ```json\n" + JSON.stringify(goodQuiz) + "\n``` hope that helps");
  assert.equal(q.questions[0].options[q.questions[0].answerIndex], "Mitochondrion");
});
test("quiz: rejects malformed output (wrong option count / bad index / no JSON)", () => {
  assert.throws(() => parseQuiz("no json here"));
  const bad = structuredClone(goodQuiz); bad.questions[0].options = ["a", "b", "c"] as unknown as typeof bad.questions[0]["options"];
  assert.throws(() => parseQuiz(JSON.stringify(bad)));
  const bad2 = structuredClone(goodQuiz); bad2.questions[0].answerIndex = 7;
  assert.throws(() => parseQuiz(JSON.stringify(bad2)));
});
test("quiz: shuffle keeps the correct answer correct for any random order", () => {
  for (let s = 0; s < 50; s++) {
    let seed = s + 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const q = shuffleQuiz(parseQuiz(JSON.stringify(goodQuiz)), rnd).questions[0];
    assert.equal(q.options[q.answerIndex], "Mitochondrion");
  }
});
test("cards: validates", () => {
  const c = parseCards(JSON.stringify({ title: "Bio", cards: [{ front: "Mitochondrion", back: "Makes ATP" }] }));
  assert.equal(c.cards.length, 1);
  assert.throws(() => parseCards(JSON.stringify({ title: "Bio", cards: [] })));
  assert.equal(extractJson('x {"a":1} y' as string) instanceof Object, true);
});

test("summaries: quiz + cards produce compact memory-ready text", () => {
  const t = summarizeQuiz("Calculus", [{ concept: "Chain rule", correct: false }, { concept: "Limits", correct: true }, { concept: "Limits", correct: true }]);
  assert.match(t, /scored 2\/3/); assert.match(t, /Struggled with: Chain rule/); assert.match(t, /solid understanding of: Limits/);
  assert.match(summarizeCards("Bio", ["ATP"], ["DNA"]), /Needed to repeat: ATP/);
});

test("tutor prompt: includes notes + sources with citation rules; graceful when memory is down", () => {
  const p = tutorSystemPrompt({ name: "Sam", level: "high", notes: ["Sam is preparing for the SAT"], sources: [{ title: "Sky", url: "u", extract: "The sky is blue because of Rayleigh scattering of sunlight." }], memoryOk: true });
  assert.match(p, /preparing for the SAT/); assert.match(p, /\[1\] Sky/); assert.match(p, /cite it like \[1\]/);
  assert.match(tutorSystemPrompt({ name: "Sam", level: "eli5", notes: [], sources: [], memoryOk: false }), /temporarily unreachable/);
});

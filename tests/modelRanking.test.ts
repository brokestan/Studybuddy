import { test } from "node:test";
import assert from "node:assert/strict";
import { rankModels, rankGeminiModels, pickModel, pickGeminiModel, parsePreferenceList } from "@/lib/modelPicker";

const GROQ_LIVE = [
  "llama-3.1-8b-instant", "qwen/qwen3.6-27b", "openai/gpt-oss-120b", "whisper-large-v3", "qwen/qwen3.8-27b",
  "groq/compound", "meta-llama/llama-4-scout-17b-16e-instruct", "moonshotai/kimi-k2-instruct", "meta-llama/llama-guard-4-12b",
];

test("rankModels: returns the FULL eligible list, best first, with nothing ineligible", () => {
  assert.deepEqual(rankModels(GROQ_LIVE), [
    "qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "moonshotai/kimi-k2-instruct", "meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.1-8b-instant",
  ]);
});

test("rankModels: live preferred ids come first IN THE ORDER GIVEN, then everything else best-first", () => {
  const r = rankModels(GROQ_LIVE, ["llama-3.1-8b-instant", "qwen/qwen3.6-27b"]);
  assert.deepEqual(r.slice(0, 2), ["llama-3.1-8b-instant", "qwen/qwen3.6-27b"]);
  assert.deepEqual(r.slice(2), ["qwen/qwen3.8-27b", "moonshotai/kimi-k2-instruct", "meta-llama/llama-4-scout-17b-16e-instruct"]);
});

test("rankModels: a preferred id that is not live (or not eligible) is ignored, not invented", () => {
  const r = rankModels(GROQ_LIVE, ["qwen/qwen3.6-27b-RETIRED", "openai/gpt-oss-120b", "qwen/qwen3.6-27b"]);
  assert.equal(r[0], "qwen/qwen3.6-27b");
  assert.ok(!r.includes("qwen/qwen3.6-27b-RETIRED"));
  assert.ok(!r.includes("openai/gpt-oss-120b"));
});

test("rankModels: no duplicates, even when the API or the preference list repeats an id", () => {
  const r = rankModels(["a-llama", "a-llama", "qwen/qwen3.8-27b"], ["qwen/qwen3.8-27b", "qwen/qwen3.8-27b", "a-llama"]);
  assert.deepEqual(r, ["qwen/qwen3.8-27b", "a-llama"]);
});

test("pickModel stays a thin wrapper: always rankModels()[0], null when nothing is eligible", () => {
  for (const pref of [[], ["llama-3.1-8b-instant"], ["nope"]]) assert.equal(pickModel(GROQ_LIVE, pref), rankModels(GROQ_LIVE, pref)[0]);
  assert.equal(pickModel(["openai/gpt-oss-120b", "whisper-large-v3"]), null);
  assert.deepEqual(rankModels([]), []);
});

const GEMINI_LIVE = [
  "models/gemini-1.5-flash", "models/gemini-2.0-flash", "models/gemini-2.0-flash-lite", "models/gemini-2.5-pro", "models/gemini-2.5-flash",
  "models/gemini-2.5-flash-lite", "models/gemini-2.5-flash-image-preview", "models/gemini-2.5-flash-tts-preview", "models/gemini-2.5-flash-live-preview",
  "models/gemini-3-flash-preview", "models/gemini-3.1-flash-lite", "models/text-embedding-004",
];

test("rankGeminiModels: full ordered fallback list of bare ids; excludes pro/image/tts/live/embedding", () => {
  assert.deepEqual(rankGeminiModels(GEMINI_LIVE), [
    "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite", "gemini-1.5-flash",
  ]);
});

test("rankGeminiModels: preferred (with or without the 'models/' prefix) goes first in the given order; unknown ids are ignored", () => {
  const r = rankGeminiModels(GEMINI_LIVE, ["models/gemini-2.0-flash", "gemini-2.5-flash", "gemini-9-flash-RETIRED"]);
  assert.deepEqual(r.slice(0, 3), ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3-flash-preview"]);
  assert.equal(new Set(r).size, r.length);
  assert.ok(!r.includes("gemini-9-flash-RETIRED"));
});

test("pickGeminiModel stays a thin wrapper over rankGeminiModels()[0]", () => {
  assert.equal(pickGeminiModel(GEMINI_LIVE), rankGeminiModels(GEMINI_LIVE)[0]);
  assert.equal(pickGeminiModel(GEMINI_LIVE, ["gemini-2.0-flash"]), "gemini-2.0-flash");
  assert.equal(pickGeminiModel(["models/gemini-2.5-pro"]), null);
});

test("parsePreferenceList: splits a comma-separated env var, trims, drops blanks and duplicates, keeps order", () => {
  assert.deepEqual(parsePreferenceList("gemini-2.5-flash,gemini-2.0-flash"), ["gemini-2.5-flash", "gemini-2.0-flash"]);
  assert.deepEqual(parsePreferenceList("  a ,, b , a ,"), ["a", "b"]);
  assert.deepEqual(parsePreferenceList(""), []);
  assert.deepEqual(parsePreferenceList(undefined), []);
  assert.deepEqual(parsePreferenceList("   "), []);
});

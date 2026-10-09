import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuizHistory, parseCardsHistory } from "@/lib/history";
import { summarizeQuiz, summarizeCards } from "@/lib/prompts";

test("history: round-trips a mixed quiz result through summarizeQuiz -> parseQuizHistory", () => {
  const text = summarizeQuiz("Derivatives", [
    { concept: "Chain rule", correct: false },
    { concept: "Power rule", correct: true },
    { concept: "Power rule", correct: true },
  ]);
  const q = parseQuizHistory(text)!;
  assert.equal(q.topic, "Derivatives");
  assert.deepEqual([q.right, q.total], [2, 3]);
  assert.deepEqual(q.missed, ["Chain rule"]);
  assert.deepEqual(q.strong, ["Power rule"]);
});

test("history: a perfect quiz score has no 'missed' but still lists strengths", () => {
  const text = summarizeQuiz("Cells", [{ concept: "Mitochondria", correct: true }]);
  assert.match(text, /Got everything right\./);
  const q = parseQuizHistory(text)!;
  assert.deepEqual([q.right, q.total, q.missed, q.strong], [1, 1, [], ["Mitochondria"]]);
});

test("history: round-trips a four-level flashcard review through summarizeCards -> parseCardsHistory", () => {
  const text = summarizeCards("Bio", { again: ["ATP", "DNA"], hard: ["Golgi"], good: ["Ribosome"], easy: ["Nucleus"] });
  const c = parseCardsHistory(text)!;
  assert.equal(c.topic, "Bio");
  assert.deepEqual(c.again, ["ATP", "DNA"]);
  assert.deepEqual(c.hard, ["Golgi"]);
  assert.deepEqual(c.good, ["Ribosome"]);
  assert.deepEqual(c.easy, ["Nucleus"]);
});

test("history: a deck with only some grades used still parses (other buckets empty)", () => {
  const c = parseCardsHistory(summarizeCards("Spanish", { again: [], hard: [], good: [], easy: ["Hola", "Adios"] }))!;
  assert.deepEqual([c.again, c.hard, c.good, c.easy], [[], [], [], ["Hola", "Adios"]]);
});

test("history: unrelated memory text is rejected by both parsers", () => {
  assert.equal(parseQuizHistory("Sam is preparing for the SAT and prefers short answers"), null);
  assert.equal(parseCardsHistory("Sam is preparing for the SAT and prefers short answers"), null);
  assert.equal(parseQuizHistory("Flashcard review on Bio."), null);
  assert.equal(parseCardsHistory("Quiz result on Bio: scored 1/1."), null);
});

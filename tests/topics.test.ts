import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTopicMemory, parseTopicMemory, groupBySubject, summarizeSubjects } from "@/lib/topics";

test("topics: round-trips subject/topic through format/parse", () => {
  const text = formatTopicMemory("Calculus", "Integration by parts");
  assert.deepEqual(parseTopicMemory(text), { subject: "Calculus", topic: "Integration by parts" });
});

test("topics: rejects unrelated memory text", () => {
  assert.equal(parseTopicMemory("Sam is preparing for the SAT"), null);
  assert.equal(parseTopicMemory("Quiz result on Derivatives: scored 2/3."), null);
});

test("topics: groups by subject, de-duplicates topics, keeps first-seen order", () => {
  const items = [
    { subject: "Calculus", topic: "Integration by parts" },
    { subject: "Biology", topic: "Cell organelles" },
    { subject: "Calculus", topic: "Chain rule" },
    { subject: "Calculus", topic: "Integration by parts" }, // duplicate, should not repeat
  ];
  assert.deepEqual(groupBySubject(items), [
    { subject: "Calculus", topics: ["Integration by parts", "Chain rule"] },
    { subject: "Biology", topics: ["Cell organelles"] },
  ]);
});

test("topics: summarizeSubjects produces a compact prompt-ready line, empty string when nothing yet", () => {
  const groups = groupBySubject([
    { subject: "Calculus", topic: "Integration by parts" },
    { subject: "Calculus", topic: "Chain rule" },
    { subject: "Spanish", topic: "Past tense" },
  ]);
  assert.equal(summarizeSubjects(groups), "Calculus (Integration by parts, Chain rule); Spanish (Past tense)");
  assert.equal(summarizeSubjects([]), "");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUserLine, formatAgentLine, parseRoomLine } from "@/lib/roomHistory";

test("roomHistory: round-trips a student line", () => {
  const text = formatUserLine("Sam", "I've totally mastered integration by parts, ask me anything");
  const parsed = parseRoomLine(text)!;
  assert.deepEqual(parsed, { displayName: "Sam", kind: "user", content: "I've totally mastered integration by parts, ask me anything" });
});

test("roomHistory: round-trips an agent line, capturing who it was addressed to", () => {
  const text = formatAgentLine("Sam", "Let's test that: what's the integral of x cos x?");
  const parsed = parseRoomLine(text)!;
  assert.deepEqual(parsed, { displayName: "Study Buddy", kind: "agent", addressedToName: "Sam", content: "Let's test that: what's the integral of x cos x?" });
});

test("roomHistory: content containing colons and newlines still parses (greedy content group)", () => {
  const text = formatUserLine("Alex", "Ratio is 3:2, then:\nmultiply both sides.");
  const parsed = parseRoomLine(text)!;
  assert.equal(parsed.content, "Ratio is 3:2, then:\nmultiply both sides.");
});

test("roomHistory: unrelated memory text (e.g. a private tutor note) is rejected", () => {
  assert.equal(parseRoomLine("Sam is preparing for the SAT and prefers short answers"), null);
  assert.equal(parseRoomLine("Quiz result on Derivatives: scored 2/3."), null);
});

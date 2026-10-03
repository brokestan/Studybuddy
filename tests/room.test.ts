import { test } from "node:test";
import assert from "node:assert/strict";
import { runRoomTurn, FALLBACK_REPLY, type RoomDeps, type RoomMessage } from "@/lib/roomAgent";
import { findLeaks } from "@/lib/leakGuard";
import { privateNamespace, roomNamespace, speakerIdFor } from "@/lib/identity";

const SAM = "sam-secret-code-1111";
const ALEX = "alex-secret-code-2222";

const store: Record<string, string[]> = {
  [privateNamespace(SAM)]: ["Sam consistently struggles with integration by parts and failed the last two quizzes on it"],
  [privateNamespace(ALEX)]: ["Alex prefers very short answers with a worked example and is preparing for the SAT"],
};

function makeDeps(generate: (sys: string, user: string) => string) {
  const calls = {
    recallPrivate: [] as string[],
    prompts: [] as string[],
    published: [] as RoomMessage[],
    ingestRoom: [] as string[],
    ingestPrivate: [] as { ns: string; text: string }[],
  };
  const deps: RoomDeps = {
    async recallPrivate(ns) { calls.recallPrivate.push(ns); return store[ns] ?? []; },
    async recallRoom() { return ["Alex said in the study room: the exam is on Friday"]; },
    async generate(sys, user) { calls.prompts.push(sys); return generate(sys, user); },
    async publish(m) { calls.published.push(m); },
    async ingestPrivate(ns, text) { calls.ingestPrivate.push({ ns, text }); return ["a learned fact"]; },
    async ingestRoom(_ns, text) { calls.ingestRoom.push(text); },
  };
  return { deps, calls };
}

const base = { roomId: "room-abc" };

test("R1: reads ONLY the speaker's private namespace, never anyone else's", async () => {
  const { deps, calls } = makeDeps(() => "Nice, Sam! Try integrating x*e^x.");
  await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "I've totally mastered integration by parts, ask me anything", askBuddy: true });
  assert.deepEqual(calls.recallPrivate, [privateNamespace(SAM)]);
  assert.ok(calls.prompts[0].includes("failed the last two quizzes"));
  assert.ok(!calls.prompts[0].includes("SAT"), "Alex's private note must never reach Sam's prompt");
});

test("Behaves differently per person: each speaker gets only their own notes", async () => {
  const { deps, calls } = makeDeps(() => "ok");
  await runRoomTurn(deps, { ...base, speakerCode: ALEX, speakerName: "Alex", content: "explain the quadratic formula", askBuddy: true });
  assert.ok(calls.prompts[0].includes("very short answers"));
  assert.ok(!calls.prompts[0].includes("integration by parts"));
});

test("R2: a model that leaks private wording is retried, then replaced by the fallback", async () => {
  let n = 0;
  const { deps, calls } = makeDeps(() => { n++; return "Sam, you consistently struggles with integration by parts and failed the last two quizzes on it!"; });
  const r = await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "I've totally mastered integration by parts", askBuddy: true });
  assert.equal(n, 2);
  assert.deepEqual(r.guard, { retried: true, fellBack: true });
  assert.equal(r.agentReply, FALLBACK_REPLY("Sam"));
  const agentMsg = calls.published.find((m) => m.kind === "agent")!;
  assert.ok(!agentMsg.content.includes("failed the last two quizzes"), "leak must never reach the room");
  assert.ok(calls.prompts[1].includes("STRICT MODE"));
});

test("R2: leak on the first draft, clean retry accepted", async () => {
  let n = 0;
  const { deps } = makeDeps(() => (++n === 1 ? "Sam consistently struggles with integration by parts and failed the last two quizzes on it" : "Sam, let's test that: what's the integral of x cos x?"));
  const r = await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "I've mastered integration by parts", askBuddy: true });
  assert.deepEqual(r.guard, { retried: true, fellBack: false });
  assert.match(r.agentReply!, /let's test that/);
});

test("R3: the speaker's own words AND Buddy's guard-cleared reply reach shared room memory — never a private note's actual wording", async () => {
  const { deps, calls } = makeDeps(() => "Let's try a practice problem, Sam.");
  const said = "I've totally mastered integration by parts, ask me anything";
  await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: said, askBuddy: true });
  assert.equal(calls.ingestRoom.length, 2);
  assert.ok(calls.ingestRoom.includes(`Sam said in the study room: ${said}`));
  assert.ok(calls.ingestRoom.includes("Study Buddy replied to Sam: Let's try a practice problem, Sam."));
  assert.equal(calls.ingestPrivate[0].ns, privateNamespace(SAM));
  assert.ok(!calls.ingestRoom.join().includes("failed the last two quizzes"), "the private note's actual wording must never reach shared memory, even via the now-persisted reply");
});

test("R6: an ordinary quiz answer does NOT trigger the fact-check instruction, even with private notes on hand", async () => {
  const { deps, calls } = makeDeps(() => "1945 is correct, nice work!");
  await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "1945", askBuddy: true });
  const prompt = calls.prompts[0];
  assert.ok(!/FACT-CHECK \(this message/.test(prompt), "must not switch into fact-check mode for a plain quiz answer");
  assert.match(prompt, /NOT a self-assessment/);
});

test("R6: a genuine self-assessment DOES trigger the fact-check instruction", async () => {
  const { deps, calls } = makeDeps(() => "Let's see — quick check on that.");
  await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "I already know integration by parts really well", askBuddy: true });
  const prompt = calls.prompts[0];
  assert.match(prompt, /FACT-CHECK \(this message looks like a self-assessment\)/);
});

test("R7: even without Ask Buddy, the speaker's own private memory quietly learns from what they said", async () => {
  const { deps, calls } = makeDeps(() => { throw new Error("should not be called"); });
  const r = await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "I keep failing integration by parts and my exam is Friday", askBuddy: false });
  assert.equal(r.agentReply, null);
  assert.equal(calls.ingestPrivate.length, 1);
  assert.equal(calls.ingestPrivate[0].ns, privateNamespace(SAM));
  assert.match(calls.ingestPrivate[0].text, /not addressed to the tutor/);
});

test("Send without Ask Buddy: agent silent, reads nothing private, still remembers public words", async () => {
  const { deps, calls } = makeDeps(() => { throw new Error("should not be called"); });
  const r = await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "anyone up for studying calculus tonight after dinner?", askBuddy: false });
  assert.equal(r.agentReply, null);
  assert.equal(calls.recallPrivate.length, 0);
  assert.equal(calls.prompts.length, 0);
  assert.equal(calls.published.length, 1);
  assert.equal(calls.ingestRoom.length, 1);
});

test("R5: the room turn only publishes + writes to Walrus (no other sink exists in deps)", () => {
  const { deps } = makeDeps(() => "x");
  assert.deepEqual(Object.keys(deps).sort(), ["generate", "ingestPrivate", "ingestRoom", "publish", "recallPrivate", "recallRoom"]);
});

test("Client-supplied transcript is capped and labelled unverified", async () => {
  const { deps, calls } = makeDeps(() => "ok");
  const recentLines = Array.from({ length: 30 }, (_, i) => ({ displayName: "Alex", kind: "user" as const, content: `line ${i}` }));
  await runRoomTurn(deps, { ...base, speakerCode: SAM, speakerName: "Sam", content: "help me with limits please", askBuddy: true, recentLines });
  assert.ok(calls.prompts[0].includes("line 29") && !calls.prompts[0].includes("line 5\n"));
  assert.ok(calls.prompts[0].includes("as shown on Sam's screen"));
});

test("Identity: namespaces are stable, distinct, and never contain the raw secret", () => {
  assert.equal(privateNamespace(SAM), privateNamespace(SAM.toUpperCase()));
  assert.notEqual(privateNamespace(SAM), privateNamespace(ALEX));
  assert.ok(!privateNamespace(SAM).includes("sam-secret"));
  assert.notEqual(privateNamespace(SAM), roomNamespace("room-abc"));
  assert.notEqual(speakerIdFor(SAM), speakerIdFor(ALEX));
});

test("Leak guard: catches verbatim reuse, allows ordinary topic words", () => {
  const notes = ["Sam consistently struggles with integration by parts and failed the last two quizzes on it"];
  assert.equal(findLeaks("Let's practice integration by parts together!", notes).leaked, false);
  assert.equal(findLeaks("As you know, Sam consistently struggles with integration by parts.", notes).leaked, true);
  assert.equal(findLeaks("Remember you failed the last two quizzes on it", notes).leaked, true);
  assert.equal(findLeaks("anything", ["too short"]).leaked, false);
});

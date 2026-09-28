import { test } from "node:test";
import assert from "node:assert/strict";
import { runRoomTurn, FALLBACK_REPLY, type RoomDeps, type RoomMessage } from "../lib/roomAgent";
import { findLeaks } from "../lib/leakGuard";
import { privateNamespace, roomNamespace, speakerIdFor } from "../lib/identity";

const SAM = "sam-secret-code-1111";
const ALEX = "alex-secret-code-2222";

// Each person's PRIVATE notes, keyed by their derived namespace.
const store: Record<string, string[]> = {
  [privateNamespace(SAM)]: ["Sam consistently struggles with integration by parts and failed the last two quizzes on it"],
  [privateNamespace(ALEX)]: ["Alex prefers very short answers with a worked example and is preparing for the SAT"],
};

function makeDeps(generate: (sys: string, user: string) => string) {
  const calls = {
    recallPrivate: [] as string[],
    prompts: [] as string[],
    saved: [] as RoomMessage[],
    ingestRoom: [] as string[],
    ingestPrivate: [] as { ns: string; text: string }[],
  };
  const deps: RoomDeps = {
    async recallPrivate(ns) { calls.recallPrivate.push(ns); return store[ns] ?? []; },
    async recallRoom() { return ["Alex said in the study room: the exam is on Friday"]; },
    async recentMessages() { return []; },
    async generate(sys, user) { calls.prompts.push(sys); return generate(sys, user); },
    async saveMessage(m) { calls.saved.push(m); },
    async ingestPrivate(ns, text) { calls.ingestPrivate.push({ ns, text }); return ["a learned fact"]; },
    async ingestRoom(_ns, text) { calls.ingestRoom.push(text); },
  };
  return { deps, calls };
}

test("R1: reads ONLY the speaker's private namespace, never anyone else's", async () => {
  const { deps, calls } = makeDeps(() => "Nice, Sam! Here's a quick problem to try: integrate x*e^x.");
  await runRoomTurn(deps, { roomId: "room-abc", speakerCode: SAM, speakerName: "Sam",
    content: "I've totally mastered integration by parts, ask me anything", askBuddy: true });

  assert.deepEqual(calls.recallPrivate, [privateNamespace(SAM)]);
  assert.ok(!calls.recallPrivate.includes(privateNamespace(ALEX)));
  const prompt = calls.prompts[0];
  assert.ok(prompt.includes("failed the last two quizzes"), "Sam's own note should inform Sam's reply");
  assert.ok(!prompt.includes("SAT"), "Alex's private note must never appear in Sam's prompt");
});

test("Behaves differently per person: each speaker gets only their own notes", async () => {
  const { deps, calls } = makeDeps(() => "ok");
  await runRoomTurn(deps, { roomId: "room-abc", speakerCode: ALEX, speakerName: "Alex",
    content: "explain the quadratic formula", askBuddy: true });
  const prompt = calls.prompts[0];
  assert.ok(prompt.includes("very short answers"));
  assert.ok(!prompt.includes("integration by parts"));
});

test("R2: a model that leaks private wording is retried, then replaced by the fallback", async () => {
  let n = 0;
  const { deps, calls } = makeDeps(() => {
    n++;
    return "Sam, you consistently struggles with integration by parts and failed the last two quizzes on it!";
  });
  const r = await runRoomTurn(deps, { roomId: "room-abc", speakerCode: SAM, speakerName: "Sam",
    content: "I've totally mastered integration by parts", askBuddy: true });

  assert.equal(n, 2, "one retry, then give up");
  assert.equal(r.guard.retried, true);
  assert.equal(r.guard.fellBack, true);
  assert.equal(r.agentReply, FALLBACK_REPLY("Sam"));
  const agentMsg = calls.saved.find((m) => m.kind === "agent")!;
  assert.ok(!agentMsg.content.includes("failed the last two quizzes"), "leak must never reach the shared transcript");
  assert.ok(calls.prompts[1].includes("STRICT MODE"));
});

test("R2: a leak on the first draft but a clean retry is accepted", async () => {
  let n = 0;
  const { deps } = makeDeps(() => (++n === 1
    ? "Sam consistently struggles with integration by parts and failed the last two quizzes on it"
    : "Sam, let's test that: what's the integral of x cos x?"));
  const r = await runRoomTurn(deps, { roomId: "room-abc", speakerCode: SAM, speakerName: "Sam",
    content: "I've mastered integration by parts", askBuddy: true });
  assert.equal(r.guard.retried, true);
  assert.equal(r.guard.fellBack, false);
  assert.match(r.agentReply!, /let's test that/);
});

test("R3: only the speaker's own words reach shared room memory", async () => {
  const { deps, calls } = makeDeps(() => "Let's try a practice problem, Sam.");
  const said = "I've totally mastered integration by parts, ask me anything";
  await runRoomTurn(deps, { roomId: "room-abc", speakerCode: SAM, speakerName: "Sam", content: said, askBuddy: true });

  assert.equal(calls.ingestRoom.length, 1);
  assert.equal(calls.ingestRoom[0], `Sam said in the study room: ${said}`);
  for (const t of calls.ingestRoom) {
    assert.ok(!t.includes("practice problem"), "agent reply must not be mirrored to the room");
    assert.ok(!t.includes("failed the last two quizzes"), "private notes must not be mirrored to the room");
  }
  // ...while the private extraction goes to the speaker's PRIVATE namespace only.
  assert.equal(calls.ingestPrivate.length, 1);
  assert.equal(calls.ingestPrivate[0].ns, privateNamespace(SAM));
});

test("Send without Ask Buddy: agent stays silent and reads nothing private", async () => {
  const { deps, calls } = makeDeps(() => { throw new Error("should not be called"); });
  const r = await runRoomTurn(deps, { roomId: "room-abc", speakerCode: SAM, speakerName: "Sam",
    content: "anyone up for studying calculus tonight after dinner?", askBuddy: false });
  assert.equal(r.agentReply, null);
  assert.equal(calls.recallPrivate.length, 0);
  assert.equal(calls.prompts.length, 0);
  assert.equal(calls.saved.length, 1);
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

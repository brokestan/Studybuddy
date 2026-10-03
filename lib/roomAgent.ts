// The "privileged tutor in a group chat" logic, written with injected
// dependencies so the privacy rules can be unit-tested without any network.
//
// THE RULES (each is enforced in code and covered by tests/room.test.ts):
//  R1. Private memory is only ever read for the VERIFIED speaker of the message
//      being answered. No code path reads anyone else's.
//  R2. The reply passes a deterministic guard; a reply that reproduces private
//      wording is retried once, then replaced by a safe fallback.
//  R3. Only the speaker's own words, and Buddy's own already-guard-cleared
//      replies, are written to the shared room memory. A private note's
//      wording never crosses into it.
//  R4. Which private notes were used is returned to the sender only.
//  R5. Nothing about the room is stored outside Walrus: the live feed is a
//      stateless broadcast, and room history is recalled from Walrus memory.
//  R6. The fact-check behavior only ever activates for messages that
//      genuinely look like a self-assessment — never for ordinary questions,
//      quiz answers, or chat — so Buddy doesn't awkwardly deflect to "ask me
//      privately" in the middle of normal conversation.
//  R7. Buddy quietly learns about a speaker from their own words even when
//      nobody tagged Buddy, so a study room actually feeds the private tutor
//      the same way a 1-on-1 session does.
import { privateNamespace, roomNamespace, speakerIdFor } from "./identity";
import { findLeaks } from "./leakGuard";
import {
  buildRoomSystemPrompt,
  looksLikeSelfClaim,
  privateExtractionText,
  privateSoloExtractionText,
  type RoomTranscriptLine,
} from "./prompts";
import { formatAgentLine, formatUserLine } from "./roomHistory";

export interface RoomMessage {
  id: string;
  roomId: string;
  speakerId: string;
  displayName: string;
  kind: "user" | "agent";
  addressedToName?: string | null;
  content: string;
  createdAt: string;
}

export interface RoomDeps {
  recallPrivate(namespace: string, query: string, limit: number): Promise<string[]>;
  recallRoom(namespace: string, query: string, limit: number): Promise<string[]>;
  generate(systemPrompt: string, userText: string): Promise<string>;
  /** Push to everyone in the room (stateless live feed — nothing is stored). */
  publish(m: RoomMessage): Promise<void>;
  /** Extract + store facts in a PRIVATE namespace. Returns the facts learned. */
  ingestPrivate(namespace: string, text: string): Promise<string[]>;
  /** Store text verbatim in the SHARED room namespace on Walrus. */
  ingestRoom(namespace: string, text: string): Promise<void>;
}

export interface RoomTurnInput {
  roomId: string;
  speakerCode: string; // secret; only ever hashed
  speakerName: string;
  content: string;
  askBuddy: boolean;
  /** Last few lines as displayed in the asker's browser (unverified). */
  recentLines?: RoomTranscriptLine[];
}

export interface RoomTurnResult {
  agentReply: string | null;
  usedPrivateNotes: string[];
  learnedPrivate: string[];
  guard: { retried: boolean; fellBack: boolean };
}

export const FALLBACK_REPLY = (name: string) =>
  `${name}, that touches something from our one-on-one sessions — let's go through it there. Meanwhile, want to try a quick practice question on this topic?`;

const MIN_LEARNABLE_LEN = 25; // skip "ok", "lol" — not worth a Walrus write
const newId = () => globalThis.crypto.randomUUID();

export async function runRoomTurn(deps: RoomDeps, input: RoomTurnInput): Promise<RoomTurnResult> {
  const speakerId = speakerIdFor(input.speakerCode);
  const privateNs = privateNamespace(input.speakerCode); // R1: derived from the speaker only
  const roomNs = roomNamespace(input.roomId);

  await deps.publish({
    id: newId(),
    roomId: input.roomId,
    speakerId,
    displayName: input.speakerName,
    kind: "user",
    content: input.content,
    createdAt: new Date().toISOString(),
  });

  const result: RoomTurnResult = {
    agentReply: null,
    usedPrivateNotes: [],
    learnedPrivate: [],
    guard: { retried: false, fellBack: false },
  };

  // R3 + R5: the speaker's own words are public in the room and this is the
  // ONLY durable room history, so remember them (skip trivia).
  const mirrorToRoom = async () => {
    if (input.content.trim().length < MIN_LEARNABLE_LEN) return;
    try {
      await deps.ingestRoom(roomNs, formatUserLine(input.speakerName, input.content));
    } catch (e) {
      console.error("room ingest failed (non-fatal):", e);
    }
  };

  if (!input.askBuddy) {
    await mirrorToRoom();
    // R7: even without an explicit "Ask Buddy", the private tutor should
    // still learn from what the speaker said — group study should feed the
    // same memory a 1-on-1 session would, not a dead end.
    if (input.content.trim().length >= MIN_LEARNABLE_LEN) {
      try {
        result.learnedPrivate = await deps.ingestPrivate(privateNs, privateSoloExtractionText(input.speakerName, input.content));
      } catch (e) {
        console.error("solo private ingest failed (non-fatal):", e);
      }
    }
    return result; // Buddy stays silent and never reads anyone's private notes here.
  }

  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      console.error("memory read failed (non-fatal):", e);
      return fallback;
    }
  };

  const [privateNotes, roomNotes] = await Promise.all([
    safe(deps.recallPrivate(privateNs, input.content, 5), [] as string[]),
    safe(deps.recallRoom(roomNs, input.content, 6), [] as string[]),
  ]);
  result.usedPrivateNotes = privateNotes;

  const transcript = (input.recentLines ?? []).slice(-8);
  const participants = Array.from(
    new Set(transcript.filter((m) => m.kind === "user").map((m) => m.displayName).concat(input.speakerName))
  );
  // R6: decided once per message, from the message itself — not from whether
  // private notes happen to exist, which is what was causing the fact-check
  // (and the fallback it can trigger) to fire on plain quiz answers.
  const selfClaim = looksLikeSelfClaim(input.content);

  const build = (strict: boolean) =>
    buildRoomSystemPrompt({ speakerName: input.speakerName, privateNotes, roomNotes, participants, transcript, selfClaim, strict });
  const userText = `${input.speakerName}: ${input.content}`;

  // R2: generate -> guard -> (retry) -> fallback
  let reply = await deps.generate(build(false), userText);
  if (findLeaks(reply, privateNotes).leaked) {
    result.guard.retried = true;
    reply = await deps.generate(build(true), userText);
    if (findLeaks(reply, privateNotes).leaked) {
      result.guard.fellBack = true;
      reply = FALLBACK_REPLY(input.speakerName);
    }
  }
  result.agentReply = reply;

  await deps.publish({
    id: newId(),
    roomId: input.roomId,
    speakerId: "buddy",
    displayName: "Study Buddy",
    kind: "agent",
    addressedToName: input.speakerName,
    content: reply,
    createdAt: new Date().toISOString(),
  });

  // R3: safe to store — by this point `reply` has already passed the leak
  // guard (or been replaced by the fixed, private-note-free fallback), so
  // persisting it adds no new exposure beyond what the room already saw live.
  // This is what makes room history continuous when someone revisits later.
  try {
    await deps.ingestRoom(roomNs, formatAgentLine(input.speakerName, reply));
  } catch (e) {
    console.error("agent-reply room ingest failed (non-fatal):", e);
  }

  try {
    result.learnedPrivate = await deps.ingestPrivate(privateNs, privateExtractionText(input.speakerName, input.content, reply));
  } catch (e) {
    console.error("private ingest failed (non-fatal):", e);
  }
  await mirrorToRoom(); // R3: speaker's own words only

  return result;
}

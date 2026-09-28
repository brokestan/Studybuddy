// The "privileged tutor in a group chat" logic, written with injected
// dependencies so the privacy rules can be unit-tested without network access.
//
// THE RULES (each one is enforced in code and covered by tests/room.test.ts):
//  R1. Private memory is only ever read for the VERIFIED speaker of the message
//      being answered. There is no code path that reads anyone else's.
//  R2. The reply is checked by a deterministic guard; a reply that reproduces
//      private wording is retried once, then replaced by a safe fallback.
//  R3. Only the speaker's own words (already public in the room) are written to
//      the shared room memory. Neither the agent's reply nor any private note
//      ever crosses into the shared namespace.
//  R4. Which private notes were used is returned to the sender only — it is not
//      stored in the shared transcript.
import { privateNamespace, roomNamespace, speakerIdFor } from "./identity";
import { findLeaks } from "./leakGuard";
import {
  buildRoomSystemPrompt,
  privateExtractionText,
  type RoomTranscriptLine,
} from "./prompts";

export interface RoomMessage {
  id?: string;
  roomId: string;
  speakerId: string;
  displayName: string;
  kind: "user" | "agent";
  addressedToName?: string | null;
  content: string;
  createdAt?: string;
}

export interface RoomDeps {
  recallPrivate(namespace: string, query: string, limit: number): Promise<string[]>;
  recallRoom(namespace: string, query: string, limit: number): Promise<string[]>;
  recentMessages(roomId: string, limit: number): Promise<RoomMessage[]>;
  generate(systemPrompt: string, userText: string): Promise<string>;
  saveMessage(m: RoomMessage): Promise<void>;
  /** Extract + store facts in a PRIVATE namespace. Returns the facts learned. */
  ingestPrivate(namespace: string, text: string): Promise<string[]>;
  /** Store text in the SHARED room namespace. */
  ingestRoom(namespace: string, text: string): Promise<void>;
}

export interface RoomTurnInput {
  roomId: string;
  speakerCode: string; // secret; only ever hashed
  speakerName: string;
  content: string;
  askBuddy: boolean;
}

export interface RoomTurnResult {
  agentReply: string | null;
  /** Sender-only: the private notes Buddy consulted (R4). */
  usedPrivateNotes: string[];
  learnedPrivate: string[];
  guard: { retried: boolean; fellBack: boolean };
}

export const FALLBACK_REPLY = (name: string) =>
  `${name}, I have some notes from our one-on-one sessions that are relevant here — ask me in your private tutor chat and I'll go through them with you. Meanwhile, want to try a quick practice question on this topic?`;

export async function runRoomTurn(deps: RoomDeps, input: RoomTurnInput): Promise<RoomTurnResult> {
  const speakerId = speakerIdFor(input.speakerCode);
  const privateNs = privateNamespace(input.speakerCode); // R1: derived from the speaker only
  const roomNs = roomNamespace(input.roomId);

  await deps.saveMessage({
    roomId: input.roomId,
    speakerId,
    displayName: input.speakerName,
    kind: "user",
    content: input.content,
  });

  const result: RoomTurnResult = {
    agentReply: null,
    usedPrivateNotes: [],
    learnedPrivate: [],
    guard: { retried: false, fellBack: false },
  };

  // R3: the speaker's own words are public in the room, so they may be
  // remembered for the room. Skip trivia.
  const mirrorToRoom = async () => {
    if (input.content.trim().length < 25) return;
    try {
      await deps.ingestRoom(roomNs, `${input.speakerName} said in the study room: ${input.content}`);
    } catch (e) {
      console.error("room ingest failed (non-fatal):", e);
    }
  };

  if (!input.askBuddy) {
    await mirrorToRoom();
    return result; // Buddy listens but stays silent, and reads nothing private.
  }

  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      console.error("memory read failed (non-fatal):", e);
      return fallback;
    }
  };

  const [privateNotes, roomNotes, recent] = await Promise.all([
    safe(deps.recallPrivate(privateNs, input.content, 5), [] as string[]),
    safe(deps.recallRoom(roomNs, input.content, 6), [] as string[]),
    safe(deps.recentMessages(input.roomId, 14), [] as RoomMessage[]),
  ]);
  result.usedPrivateNotes = privateNotes;

  const transcript: RoomTranscriptLine[] = recent.map((m) => ({
    displayName: m.displayName,
    kind: m.kind,
    content: m.content,
  }));
  const participants = Array.from(
    new Set(recent.filter((m) => m.kind === "user").map((m) => m.displayName).concat(input.speakerName))
  );

  const build = (strict: boolean) =>
    buildRoomSystemPrompt({
      speakerName: input.speakerName,
      privateNotes,
      roomNotes,
      participants,
      transcript,
      strict,
    });
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

  await deps.saveMessage({
    roomId: input.roomId,
    speakerId: "buddy",
    displayName: "Study Buddy",
    kind: "agent",
    addressedToName: input.speakerName,
    content: reply,
  });

  // Learning: private facts go to the speaker's PRIVATE namespace only.
  try {
    result.learnedPrivate = await deps.ingestPrivate(
      privateNs,
      privateExtractionText(input.speakerName, input.content, reply)
    );
  } catch (e) {
    console.error("private ingest failed (non-fatal):", e);
  }
  await mirrorToRoom(); // R3: speaker's own words only — never `reply`, never `privateNotes`

  return result;
}

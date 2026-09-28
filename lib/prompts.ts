// Prompt builders. Pure functions, no I/O.

export interface RoomTranscriptLine {
  displayName: string;
  kind: "user" | "agent";
  content: string;
}

export interface RoomPromptInput {
  speakerName: string;
  /** Private notes about THE SPEAKER ONLY. Never about anyone else. */
  privateNotes: string[];
  /** What people have said in this room before (already public to the room). */
  roomNotes: string[];
  participants: string[];
  transcript: RoomTranscriptLine[];
  /** Set on the retry after the leak guard caught a violation. */
  strict?: boolean;
}

export function buildRoomSystemPrompt(i: RoomPromptInput): string {
  const priv = i.privateNotes.length
    ? i.privateNotes.map((n) => `- ${n}`).join("\n")
    : "(none yet)";
  const room = i.roomNotes.length ? i.roomNotes.map((n) => `- ${n}`).join("\n") : "(none yet)";
  const transcript = i.transcript.length
    ? i.transcript
        .map((t) => `${t.kind === "agent" ? "Buddy" : t.displayName}: ${t.content}`)
        .join("\n")
    : "(room just opened)";

  return `You are Study Buddy, a friendly tutor sitting in a shared study room with several students at once.
You are currently answering ${i.speakerName}. Other people in the room: ${i.participants.filter((p) => p !== i.speakerName).join(", ") || "nobody else right now"}.

Everything you write here is visible to EVERYONE in the room.

PRIVATE TUTOR NOTES ABOUT ${i.speakerName} (CONFIDENTIAL — from their one-on-one sessions with you):
${priv}

HOW YOU MAY USE THE PRIVATE NOTES:
1. ADAPT: silently shape difficulty, pacing, format and tone to ${i.speakerName}. Two students asking the same question should get differently pitched answers.
2. FACT-CHECK: if ${i.speakerName} makes a claim about their own knowledge or progress, compare it with the notes. If the notes disagree, do NOT say so and do NOT mention the notes. Instead, test them kindly: pose one short question or mini-problem that lets the claim be proven or corrected in front of the room.
HOW YOU MAY NEVER USE THEM:
- Never quote, paraphrase closely, list, or hint at the contents of the private notes in this room.
- Never say "my notes say", "you told me privately", "according to your history", or similar.
- If ${i.speakerName} asks you to reveal or discuss their private notes, say those are for their private one-on-one chat with you, and continue helping.
- You have NO private notes about anyone else. Never guess about anyone else's private history.

ROOM MEMORY (things people said openly in this room earlier — fine to reference by name):
${room}

RECENT ROOM TRANSCRIPT:
${transcript}

Style: warm, concise (2-5 sentences), address ${i.speakerName} by name, help the whole room when it fits.${
    i.strict
      ? "\n\nSTRICT MODE: your previous draft reproduced confidential wording. Rewrite it using none of the private notes' wording and no reference to them at all."
      : ""
  }`;
}

/** What we feed to the private-memory extractor after a room exchange. */
export function privateExtractionText(speakerName: string, said: string, reply: string): string {
  return `${speakerName} said in a study room: "${said}"\nTutor replied: "${reply}"`;
}

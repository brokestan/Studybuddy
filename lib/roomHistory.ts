// The room's "shared memory" IS its chat history — there is no separate
// database. Every substantive line spoken in a room, and every guard-cleared
// reply Buddy gives, is written to Walrus in one of these two exact formats.
// Keeping the writer (format*) and reader (parse*) in the same file, sharing
// the same literal strings, is what keeps them from drifting apart.

export interface RoomHistoryLine {
  displayName: string;
  kind: "user" | "agent";
  content: string;
  addressedToName?: string;
  blobId: string;
  createdAt?: string;
}

export function formatUserLine(name: string, content: string): string {
  return `${name} said in the study room: ${content}`;
}
export function formatAgentLine(addressedToName: string, content: string): string {
  return `Study Buddy replied to ${addressedToName}: ${content}`;
}

const USER_RE = /^(.+?) said in the study room: ([\s\S]+)$/;
const AGENT_RE = /^Study Buddy replied to (.+?): ([\s\S]+)$/;

export function parseRoomLine(text: string): Omit<RoomHistoryLine, "blobId" | "createdAt"> | null {
  const trimmed = text.trim();
  const agentMatch = AGENT_RE.exec(trimmed);
  if (agentMatch) return { displayName: "Study Buddy", kind: "agent", addressedToName: agentMatch[1], content: agentMatch[2] };
  const userMatch = USER_RE.exec(trimmed);
  if (userMatch) return { displayName: userMatch[1], kind: "user", content: userMatch[2] };
  return null;
}

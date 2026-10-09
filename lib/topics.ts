// Precise subject/topic tracking, kept separate from the free-text notes
// analyze() extracts. Same idea as lib/history.ts and lib/roomHistory.ts:
// one fixed, parseable format so Memory Lens and the tutor prompt can read
// it back reliably instead of hoping a semantic search happens to surface it.

export interface TopicMemory {
  subject: string;
  topic: string;
  blobId: string;
  createdAt?: string;
}

export function formatTopicMemory(subject: string, topic: string): string {
  return `Studied: ${subject} — ${topic}`;
}

const TOPIC_RE = /^Studied: (.+?) — (.+)$/;

export function parseTopicMemory(text: string): Omit<TopicMemory, "blobId" | "createdAt"> | null {
  const m = TOPIC_RE.exec(text.trim());
  return m ? { subject: m[1].trim(), topic: m[2].trim() } : null;
}

export interface SubjectGroup {
  subject: string;
  topics: string[];
}

/** Groups parsed topic memories by subject, de-duplicating topics and
 *  preserving first-seen order (oldest first, since callers pass notes in
 *  chronological order from Walrus). */
export function groupBySubject(items: Omit<TopicMemory, "blobId" | "createdAt">[]): SubjectGroup[] {
  const bySubject = new Map<string, string[]>();
  for (const { subject, topic } of items) {
    const list = bySubject.get(subject) ?? [];
    if (!list.includes(topic)) list.push(topic);
    bySubject.set(subject, list);
  }
  return [...bySubject.entries()].map(([subject, topics]) => ({ subject, topics }));
}

/** Compact one-line-per-subject summary, fed into the tutor's system prompt
 *  so continuity doesn't rely on the model noticing it in freeform notes. */
export function summarizeSubjects(groups: SubjectGroup[]): string {
  if (!groups.length) return "";
  return groups.map((g) => `${g.subject} (${g.topics.join(", ")})`).join("; ");
}

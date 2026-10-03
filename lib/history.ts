// Turns the deterministic quiz/flashcard summary strings (written by
// summarizeQuiz/summarizeCards in prompts.ts) back into structured data, so
// past results can be listed without a separate database — the memory text
// itself is the record. Pure, so it's easy to test against the exact format
// those two functions produce.

export interface QuizHistoryItem {
  topic: string;
  right: number;
  total: number;
  missed: string[];
  strong: string[];
  blobId: string;
  createdAt?: string;
}
export interface CardsHistoryItem {
  topic: string;
  again: string[];
  hard: string[];
  good: string[];
  easy: string[];
  blobId: string;
  createdAt?: string;
}

// Order matters: summarizeQuiz writes "scored X/Y." then EITHER "Struggled
// with: ..." OR "Got everything right." (never both), THEN, separately,
// "Showed solid understanding of: ...".
const QUIZ_RE = /^Quiz result on (.+?): scored (\d+)\/(\d+)\.(?: Struggled with: (.+?)\.| Got everything right\.)?(?: Showed solid understanding of: (.+?)\.)?$/;
// Four independent, optional clauses, always in this order (see summarizeCards).
const CARDS_RE =
  /^Flashcard review on (.+?)\.(?: Still shaky on: (.+?)\.)?(?: Needs more practice: (.+?)\.)?(?: Comfortable with: (.+?)\.)?(?: Knows cold: (.+?)\.)?$/;

export function parseQuizHistory(text: string): Omit<QuizHistoryItem, "blobId" | "createdAt"> | null {
  const m = QUIZ_RE.exec(text.trim());
  if (!m) return null;
  return { topic: m[1], right: Number(m[2]), total: Number(m[3]), missed: m[4] ? m[4].split(", ") : [], strong: m[5] ? m[5].split(", ") : [] };
}

export function parseCardsHistory(text: string): Omit<CardsHistoryItem, "blobId" | "createdAt"> | null {
  const m = CARDS_RE.exec(text.trim());
  if (!m) return null;
  return {
    topic: m[1],
    again: m[2] ? m[2].split("; ") : [],
    hard: m[3] ? m[3].split("; ") : [],
    good: m[4] ? m[4].split("; ") : [],
    easy: m[5] ? m[5].split("; ") : [],
  };
}

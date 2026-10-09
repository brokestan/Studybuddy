import { recallSafe } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { parseQuizHistory, parseCardsHistory, type QuizHistoryItem, type CardsHistoryItem } from "@/lib/history";
import { HistoryBody } from "@/lib/schemas";
import { limited, parse, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Past quiz/flashcard results aren't a separate database — they're regular
// Walrus memories written by /api/quiz/submit and /api/cards/review in a
// fixed, parseable format (see lib/history.ts). This route recalls them back
// and splits them into the two lists the Quiz/Flashcards pages show.
export async function POST(req: Request) {
  const lim = limited(req, "history", 10);
  if (lim) return lim;
  const p = await parse(req, HistoryBody);
  if (!p.ok) return p.res;
  const ns = privateNamespace(p.data.code);

  const r = await recallSafe(ns, "quiz result flashcard review score performance topic", { limit: 40, sort: "recent" });
  const quizzes: QuizHistoryItem[] = [];
  const decks: CardsHistoryItem[] = [];
  for (const n of r.notes) {
    const q = parseQuizHistory(n.text);
    if (q) {
      quizzes.push({ ...q, blobId: n.blobId, createdAt: n.createdAt });
      continue;
    }
    const c = parseCardsHistory(n.text);
    if (c) decks.push({ ...c, blobId: n.blobId, createdAt: n.createdAt });
  }
  return json({ ok: r.ok, quizzes, decks });
}

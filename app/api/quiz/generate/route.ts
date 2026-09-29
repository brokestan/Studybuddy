import { chatJson } from "@/lib/llm";
import { recallSafe } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { quizPrompt } from "@/lib/prompts";
import { parseQuiz, shuffleQuiz } from "@/lib/quizJson";
import { groundOn } from "@/lib/wiki";
import { QuizGenBody } from "@/lib/schemas";
import { limited, parse, json, fail, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const lim = limited(req, "quiz", 8);
  if (lim) return lim;
  const p = await parse(req, QuizGenBody);
  if (!p.ok) return p.res;
  const { code, topic, count, difficulty } = p.data;
  const ns = privateNamespace(code);
  try {
    const [mem, sources] = await Promise.all([
      recallSafe(ns, `${topic} struggles mistakes weak`, { limit: 5, maxDistance: 0.8 }),
      groundOn(topic),
    ]);
    const quiz = await chatJson(
      [{ role: "user", content: quizPrompt({ topic, count, difficulty, notes: mem.notes.map((n) => n.text), sources }) }],
      parseQuiz,
      { maxTokens: 2500 }
    );
    return json({
      quiz: shuffleQuiz(quiz),
      personalizedFrom: mem.notes.map((n) => n.text),
      sources: sources.map((s) => ({ title: s.title, url: s.url })),
    });
  } catch (e) {
    return fail(`Couldn't build that quiz: ${errMsg(e)}`, 502);
  }
}

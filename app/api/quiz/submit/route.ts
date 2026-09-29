import { remember } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { summarizeQuiz } from "@/lib/prompts";
import { QuizSubmitBody } from "@/lib/schemas";
import { limited, parse, json, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Turns a finished quiz into ONE compact memory on Walrus, so Buddy knows next time what to revisit.
export async function POST(req: Request) {
  const lim = limited(req, "quizsubmit", 12);
  if (lim) return lim;
  const p = await parse(req, QuizSubmitBody);
  if (!p.ok) return p.res;
  const { code, topic, results } = p.data;
  const summary = summarizeQuiz(topic, results);
  try {
    await remember(privateNamespace(code), summary);
    return json({ saved: true, summary });
  } catch (e) {
    return json({ saved: false, summary, error: errMsg(e) });
  }
}

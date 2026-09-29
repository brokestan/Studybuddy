import { chatJson } from "@/lib/llm";
import { recallSafe } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { cardsPrompt } from "@/lib/prompts";
import { parseCards } from "@/lib/quizJson";
import { groundOn } from "@/lib/wiki";
import { CardsGenBody } from "@/lib/schemas";
import { limited, parse, json, fail, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const lim = limited(req, "cards", 8);
  if (lim) return lim;
  const p = await parse(req, CardsGenBody);
  if (!p.ok) return p.res;
  const { code, topic, count } = p.data;
  const ns = privateNamespace(code);
  try {
    const [mem, sources] = await Promise.all([
      recallSafe(ns, `${topic} struggles needed to repeat`, { limit: 5, maxDistance: 0.8 }),
      groundOn(topic),
    ]);
    const deck = await chatJson([{ role: "user", content: cardsPrompt({ topic, count, notes: mem.notes.map((n) => n.text), sources }) }], parseCards, { maxTokens: 2500 });
    return json({ deck, personalizedFrom: mem.notes.map((n) => n.text), sources: sources.map((s) => ({ title: s.title, url: s.url })) });
  } catch (e) {
    return fail(`Couldn't build that deck: ${errMsg(e)}`, 502);
  }
}

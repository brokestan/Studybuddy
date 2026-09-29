import { remember } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { summarizeCards } from "@/lib/prompts";
import { CardsReviewBody } from "@/lib/schemas";
import { limited, parse, json, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const lim = limited(req, "cardsreview", 12);
  if (lim) return lim;
  const p = await parse(req, CardsReviewBody);
  if (!p.ok) return p.res;
  const { code, topic, hard, easy } = p.data;
  if (!hard.length && !easy.length) return json({ saved: false, summary: "" });
  const summary = summarizeCards(topic, hard, easy);
  try {
    await remember(privateNamespace(code), summary);
    return json({ saved: true, summary });
  } catch (e) {
    return json({ saved: false, summary, error: errMsg(e) });
  }
}

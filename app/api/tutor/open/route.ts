import { z } from "zod";
import { chatJson } from "@/lib/llm";
import { recallSafe, type Note } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { openerPrompt } from "@/lib/prompts";
import { extractJson } from "@/lib/quizJson";
import { OpenBody } from "@/lib/schemas";
import { limited, parse, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const Opener = z.object({ greeting: z.string().min(5).max(400), suggestions: z.array(z.string().min(2).max(60)).length(3) });

const FIRST_TIME = (name: string) => ({
  returning: false,
  greeting: `Hi ${name}! I'm Study Buddy. Tell me what you're studying and what you're aiming for — I'll remember it on Walrus, so next time we pick up right where we left off.`,
  suggestions: ["I'm studying for an exam", "Explain a topic simply", "Quiz me on something"],
  notes: [] as { text: string; blobId: string; createdAt?: string }[],
});

// Session opener: proves memory at a glance — the first thing you see is Buddy remembering you.
export async function POST(req: Request) {
  const lim = limited(req, "open", 12);
  if (lim) return lim;
  const p = await parse(req, OpenBody);
  if (!p.ok) return p.res;
  const { code, name } = p.data;
  const ns = privateNamespace(code);

  const [recent, goals, weak] = await Promise.all([
    recallSafe(ns, "study session topics goals", { limit: 5, sort: "recent" }),
    recallSafe(ns, "exam deadline goal studying for", { limit: 3, maxDistance: 0.8 }),
    recallSafe(ns, "struggles mistakes confused weak", { limit: 3, maxDistance: 0.8 }),
  ]);
  const seen = new Set<string>();
  const notes: Note[] = [...goals.notes, ...weak.notes, ...recent.notes].filter((n) => !seen.has(n.blobId) && seen.add(n.blobId)).slice(0, 8);
  const memoryOk = recent.ok || goals.ok || weak.ok;
  if (!notes.length) return json({ ...FIRST_TIME(name), memoryOk });

  const shown = notes.map((n) => ({ text: n.text, blobId: n.blobId, createdAt: n.createdAt }));
  try {
    const o = await chatJson([{ role: "user", content: openerPrompt({ name, notes: notes.map((n) => n.text) }) }], (t) => Opener.parse(extractJson(t)), { maxTokens: 300 });
    return json({ returning: true, memoryOk, ...o, notes: shown });
  } catch {
    return json({
      returning: true,
      memoryOk,
      greeting: `Welcome back, ${name}! I remember our earlier sessions — want to pick up where we left off?`,
      suggestions: ["Continue where we left off", "Quiz me on my weak spots", "What do you remember about me?"],
      notes: shown,
    });
  }
}

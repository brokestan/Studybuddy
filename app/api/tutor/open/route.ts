import { z } from "zod";
import { chatJson } from "@/lib/llm";
import { recallSafe, recallTimeoutMs, recallTimedOut, type Note } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { openerPrompt } from "@/lib/prompts";
import { extractJson } from "@/lib/quizJson";
import { OpenBody } from "@/lib/schemas";
import { limited, parse, json, withTimeout } from "@/lib/http";

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

// How long the greeting may spend asking the LLM to write itself. Past this we
// use the plain "welcome back" text below: the student's own notes are still shown.
const openerLlmTimeoutMs = () => Number(process.env.OPENER_LLM_TIMEOUT_MS) || 12_000; // env override: optional tuning / tests

// Shown when Walrus could not be reached at all. Must NOT claim this is a first
// visit (it may well be a returning student) or promise to remember this session.
const MEMORY_DOWN = (name: string) => ({
  returning: false,
  greeting: `Hi ${name}! I couldn't reach your Walrus memory just now, so I can't pick up where we left off yet — but I can still teach. What are we studying?`,
  suggestions: ["Explain a topic simply", "Quiz me on something", "Help me study for an exam"],
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
    // Each recall is capped (~6s): a cold start or slow relayer must never leave
    // the student on "checking what Walrus remembers" indefinitely.
    withTimeout(recallSafe(ns, "study session topics goals", { limit: 5, sort: "recent" }), recallTimeoutMs(), recallTimedOut()),
    withTimeout(recallSafe(ns, "exam deadline goal studying for", { limit: 3, maxDistance: 0.8 }), recallTimeoutMs(), recallTimedOut()),
    withTimeout(recallSafe(ns, "struggles mistakes confused weak", { limit: 3, maxDistance: 0.8 }), recallTimeoutMs(), recallTimedOut()),
  ]);
  const seen = new Set<string>();
  const notes: Note[] = [...goals.notes, ...weak.notes, ...recent.notes].filter((n) => !seen.has(n.blobId) && seen.add(n.blobId)).slice(0, 8);
  const memoryOk = recent.ok || goals.ok || weak.ok;
  if (!memoryOk) return json({ ...MEMORY_DOWN(name), memoryOk });
  if (!notes.length) return json({ ...FIRST_TIME(name), memoryOk });

  const shown = notes.map((n) => ({ text: n.text, blobId: n.blobId, createdAt: n.createdAt }));
  try {
    // null = the LLM took too long: drop to the plain greeting below (same path as an LLM error).
    const o = await withTimeout(
      chatJson([{ role: "user", content: openerPrompt({ name, notes: notes.map((n) => n.text) }) }], (t) => Opener.parse(extractJson(t)), { maxTokens: 300 }),
      openerLlmTimeoutMs(),
      null
    );
    if (!o) throw new Error("opener LLM timed out");
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

import { recallSafe, stats, type Note } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { LensBody } from "@/lib/schemas";
import { limited, parse, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CATS = [
  { id: "goals", title: "Goals & exams", q: "exam deadline goal studying for preparing" },
  { id: "weak", title: "Weak spots", q: "struggles mistakes confused difficulty missed weak" },
  { id: "strong", title: "Strengths", q: "mastered strong solid understanding knows well confident" },
  { id: "style", title: "How you learn", q: "prefers learning style short answers examples visual" },
] as const;

const view = (n: Note) => ({ text: n.text, blobId: n.blobId, createdAt: n.createdAt });

// "Memory Lens": everything Buddy remembers about you, straight from Walrus.
export async function POST(req: Request) {
  const lim = limited(req, "lens", 10);
  if (lim) return lim;
  const p = await parse(req, LensBody);
  if (!p.ok) return p.res;
  const ns = privateNamespace(p.data.code);

  const [recent, ...cats] = await Promise.all([
    recallSafe(ns, "study session learning", { limit: 12, sort: "recent" }),
    ...CATS.map((c) => recallSafe(ns, c.q, { limit: 6, maxDistance: 0.75 })),
  ]);
  const st = await stats(ns).catch(() => null);

  const seen = new Set<string>();
  const categories = CATS.map((c, i) => ({
    id: c.id,
    title: c.title,
    items: cats[i].notes.filter((n) => !seen.has(n.blobId) && seen.add(n.blobId)).map(view),
  }));
  return json({
    ok: recent.ok && cats.every((c) => c.ok),
    recent: recent.notes.map(view),
    categories,
    stats: st,
  });
}

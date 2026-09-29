import { recallSafe } from "@/lib/memory";
import { roomNamespace } from "@/lib/identity";
import { RecapBody } from "@/lib/schemas";
import { limited, parse, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Room history is NOT in a database: it is recalled from the room's shared Walrus memory.
export async function POST(req: Request) {
  const lim = limited(req, "recap", 20);
  if (lim) return lim;
  const p = await parse(req, RecapBody);
  if (!p.ok) return p.res;
  const r = await recallSafe(roomNamespace(p.data.roomId), "study room discussion", { limit: 12, sort: "recent" });
  const notes = r.notes
    .map((n) => ({ text: n.text, blobId: n.blobId, createdAt: n.createdAt }))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return json({ ok: r.ok, notes });
}

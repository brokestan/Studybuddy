import { recallSafe } from "@/lib/memory";
import { roomNamespace } from "@/lib/identity";
import { parseRoomLine, type RoomHistoryLine } from "@/lib/roomHistory";
import { RecapBody } from "@/lib/schemas";
import { limited, parse, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Room history is NOT in a database: every line (each student's own words,
// and Buddy's already guard-cleared replies) was written to the room's
// shared Walrus memory as it happened, and this route reads it straight
// back as an ordered transcript — so leaving and revisiting a room (or
// joining one already in progress) doesn't lose the conversation, even
// though the live feed itself (Supabase Broadcast) keeps nothing.
export async function POST(req: Request) {
  const lim = limited(req, "recap", 20);
  if (lim) return lim;
  const p = await parse(req, RecapBody);
  if (!p.ok) return p.res;

  // maxDistance intentionally omitted: for a transcript we want everything
  // recent, not just what's semantically close to a made-up query string.
  const r = await recallSafe(roomNamespace(p.data.roomId), "room conversation", { limit: 60, sort: "recent" });

  const lines: RoomHistoryLine[] = [];
  for (const n of r.notes) {
    const parsed = parseRoomLine(n.text);
    if (parsed) lines.push({ ...parsed, blobId: n.blobId, createdAt: n.createdAt });
  }
  lines.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return json({ ok: r.ok, lines });
}

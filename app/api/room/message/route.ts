import { chat } from "@/lib/llm";
import { recallSafe, learn, remember } from "@/lib/memory";
import { publishToRoom } from "@/lib/realtime";
import { runRoomTurn, type RoomDeps } from "@/lib/roomAgent";
import { RoomMessageBody } from "@/lib/schemas";
import { limited, parse, json, fail, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const lim = limited(req, "room", 30);
  if (lim) return lim;
  const p = await parse(req, RoomMessageBody);
  if (!p.ok) return p.res;
  const { roomId, code, name, content, askBuddy, recentLines } = p.data;

  const deps: RoomDeps = {
    // NOTE: left at the tutor's own proven threshold (0.8→0.75 here to match
    // prior behavior) rather than guessing a tighter number. The real fix for
    // "Buddy references private context that isn't relevant" is the
    // selfClaim gating in lib/prompts.ts (see runRoomTurn/buildRoomSystemPrompt) —
    // it controls WHEN a recalled note may be used for fact-checking, which is
    // the part that was actually misfiring. Recall staying reasonably permissive
    // is fine and desirable for the low-risk ADAPT (tone/difficulty) use.
    recallPrivate: async (ns, q, limit) => (await recallSafe(ns, q, { limit, maxDistance: 0.75 })).notes.map((n) => n.text),
    recallRoom: async (ns, q, limit) => (await recallSafe(ns, q, { limit, maxDistance: 0.75 })).notes.map((n) => n.text),
    generate: (system, user) => chat([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 500 }),
    publish: (m) => publishToRoom(roomId, m),
    ingestPrivate: async (ns, text) => (await learn(ns, text)).facts,
    ingestRoom: (ns, text) => remember(ns, text),
  };

  try {
    const r = await runRoomTurn(deps, { roomId, speakerCode: code, speakerName: name, content, askBuddy, recentLines });
    // R4: which private notes were used goes back to the SENDER only. It is never broadcast or stored.
    return json({ usedPrivateNotes: r.usedPrivateNotes, learnedPrivate: r.learnedPrivate, guard: r.guard });
  } catch (e) {
    return fail(errMsg(e), 502);
  }
}

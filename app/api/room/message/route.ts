import { answerOnce } from "@/lib/ai";
import { recallSafe, learn, remember } from "@/lib/memory";
import { publishToRoom } from "@/lib/realtime";
import { runRoomTurn, type RoomDeps } from "@/lib/roomAgent";
import { formatUserLine } from "@/lib/roomHistory";
import { roomNamespace } from "@/lib/identity";
import { RoomMessageBody } from "@/lib/schemas";
import { limited, parse, json, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Mirrors roomAgent.ts's own cut-off for "too trivial to remember" so the
// failure path below stores exactly what a successful turn would have.
const MIN_LEARNABLE_LEN = 25;

export async function POST(req: Request) {
  const lim = limited(req, "room", 30);
  if (lim) return lim;
  const p = await parse(req, RoomMessageBody);
  if (!p.ok) return p.res;
  const { roomId, code, name, content, askBuddy, recentLines, provider } = p.data;

  // Which model really answered (after any within-provider fallback) is
  // captured here, in the route, so RoomDeps.generate keeps its plain
  // string -> string shape and roomAgent.ts's tested core is untouched.
  let answeredBy: string | null = null;
  // Has the speaker's own line already gone out to the room? (Decides what a failure means, below.)
  let posted = false;

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
    generate: async (system, user) => {
      const r = await answerOnce(provider, [{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 500 });
      answeredBy = r.model;
      return r.text;
    },
    publish: async (m) => {
      await publishToRoom(roomId, m);
      if (m.kind === "user") posted = true;
    },
    ingestPrivate: async (ns, text) => (await learn(ns, text)).facts,
    ingestRoom: (ns, text) => remember(ns, text),
  };

  try {
    const r = await runRoomTurn(deps, { roomId, speakerCode: code, speakerName: name, content, askBuddy, recentLines });
    // R4: which private notes were used goes back to the SENDER only. It is never broadcast or stored.
    // The model that answered is sender-only too — it is deliberately not part of the broadcast payload.
    return json({ usedPrivateNotes: r.usedPrivateNotes, learnedPrivate: r.learnedPrivate, guard: r.guard, provider, model: answeredBy });
  } catch (e) {
    // If Buddy couldn't answer (e.g. every Gemini model is busy) AFTER the
    // student's own line was already broadcast, that line is live in the room
    // but the turn aborted before it was saved to Walrus. Save it now so room
    // history stays complete, and tell the client the message DID go out so it
    // doesn't hand the text back to be re-sent as a duplicate.
    if (posted && content.trim().length >= MIN_LEARNABLE_LEN) {
      try {
        await remember(roomNamespace(roomId), formatUserLine(name, content));
      } catch (e2) {
        console.error("room ingest after failed turn (non-fatal):", e2);
      }
    }
    return json({ error: errMsg(e), posted }, 502);
  }
}

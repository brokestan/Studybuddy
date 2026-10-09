import { candidatesFor } from "@/lib/ai";
import { health, isMock, memwalEnv, namespaceBreakdown, stats } from "@/lib/memory";
import { broadcast, realtimeConfigured } from "@/lib/realtime";
import { limited, json, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Setup check for the /status page: tells you exactly what is wired and what isn't,
// with no terminal needed. Never returns secrets, only yes/no and counts.
export async function GET(req: Request) {
  const lim = limited(req, "status", 12);
  if (lim) return lim;
  const m = memwalEnv();
  const out: Record<string, unknown> = {
    time: new Date().toISOString(),
    mock: isMock(),
    devTests: process.env.ENABLE_DEV_TESTS === "true",
    env: {
      GROQ_API_KEY: Boolean(process.env.GROQ_API_KEY),
      MEMWAL_PRIVATE_KEY: Boolean(m.key),
      MEMWAL_ACCOUNT_ID: Boolean(m.accountId),
      MEMWAL_SERVER_URL: m.serverUrl,
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    },
  };

  // `candidates` is the whole fallback picture: the ranked order requests walk
  // through, what is cooling down (and for how long), and what is tried first
  // right now. Choosing models is done with the comma-separated GROQ_MODEL /
  // GEMINI_MODEL env vars (an ordered preference list) — this page only shows.
  try {
    const c = await candidatesFor("groq", true);
    out.llm = { ok: true, model: c.tryOrder[0], verified: c.verified, candidates: c };
  } catch (e) {
    out.llm = { ok: false, error: errMsg(e) };
  }

  // Optional: only checked if a key is present. The Tutor page falls back to
  // Groq-only automatically when this isn't configured — Gemini is a second
  // option, not a requirement.
  if (process.env.GEMINI_API_KEY) {
    try {
      const c = await candidatesFor("gemini", true);
      out.gemini = { ok: true, model: c.tryOrder[0], verified: c.verified, candidates: c };
    } catch (e) {
      out.gemini = { ok: false, error: errMsg(e) };
    }
  } else {
    out.gemini = { ok: false, error: "Not configured (optional — lets students switch the Tutor's AI mid-conversation)." };
  }

  try {
    const h = await health();
    const s = await stats().catch(() => null);
    out.memwal = { ok: true, health: h, totalMemories: s?.total ?? null, target: 10 };
  } catch (e) {
    out.memwal = { ok: false, error: errMsg(e) };
  }

  // Usage analytics (how many memory keys / study rooms have ever stored
  // something). COUNTS ONLY — names are never returned (see lib/namespaceStats.ts).
  // Behind ENABLE_DEV_TESTS like the other dev-only tooling: /api/status has no
  // login, and this is an extra pass over the account's namespaces.
  if (process.env.ENABLE_DEV_TESTS === "true") {
    try {
      out.usage = { ok: true, ...(await namespaceBreakdown()) };
    } catch (e) {
      out.usage = { ok: false, error: errMsg(e) };
    }
  }

  if (!realtimeConfigured()) {
    out.realtime = { ok: false, error: "Not configured (only needed for the Study Room)." };
  } else {
    try {
      const r = await broadcast("sb-status-probe", "probe", { t: Date.now() });
      out.realtime = { ok: r.ok, status: r.status };
    } catch (e) {
      out.realtime = { ok: false, error: errMsg(e) };
    }
  }
  return json(out);
}

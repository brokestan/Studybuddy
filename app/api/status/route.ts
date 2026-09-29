import { listModels, resolveModel } from "@/lib/llm";
import { health, isMock, memwalEnv, stats } from "@/lib/memory";
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
    },
  };

  try {
    const r = await resolveModel(true);
    const all = await listModels().catch(() => []);
    out.llm = { ok: true, model: r.model, verified: r.verified, modelsListed: all.length };
  } catch (e) {
    out.llm = { ok: false, error: errMsg(e) };
  }

  try {
    const h = await health();
    const s = await stats().catch(() => null);
    out.memwal = { ok: true, health: h, totalMemories: s?.total ?? null, target: 10 };
  } catch (e) {
    out.memwal = { ok: false, error: errMsg(e) };
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

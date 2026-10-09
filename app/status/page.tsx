"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { postJson } from "@/lib/client/api";

interface Candidates {
  ranked: string[];
  tryOrder: string[];
  cooling: { model: string; secondsLeft: number }[];
  verified: boolean;
}
interface Usage { ok: boolean; privateProfiles?: number; studyRooms?: number; privateMemories?: number; roomMemories?: number; other?: number; truncated?: boolean; error?: string }

interface Status {
  time: string;
  mock: boolean;
  devTests: boolean;
  env: Record<string, boolean | string>;
  llm?: { ok: boolean; model?: string; verified?: boolean; candidates?: Candidates; error?: string };
  gemini?: { ok: boolean; model?: string; verified?: boolean; candidates?: Candidates; error?: string };
  usage?: Usage;
  memwal?: { ok: boolean; totalMemories?: number | null; target?: number; error?: string };
  realtime?: { ok: boolean; status?: number; error?: string };
}

/** The fallback order for one provider: what gets tried, in order, and what is cooling down right now. */
function Fallbacks({ c, envName }: { c?: Candidates; envName: string }) {
  if (!c) return null;
  const cooling = new Map(c.cooling.map((x) => [x.model, x.secondsLeft]));
  return (
    <>
      <br />
      <span className="tiny">
        If a model is busy or retired, requests move down this list inside the same request (most-preferred first):
      </span>
      <ol className="tiny" style={{ margin: "6px 0 0", paddingLeft: 20 }}>
        {c.ranked.map((m) => (
          <li key={m}>
            <code>{m}</code>
            {cooling.has(m) && <span className="chip coral" style={{ marginLeft: 8 }}>cooling down · {cooling.get(m)}s left</span>}
          </li>
        ))}
      </ol>
      <span className="tiny">
        {c.verified ? "" : "Couldn’t reach the provider’s model list, so this is only the configured/last-resort list. "}
        To choose or reorder, set <code>{envName}</code> in Vercel to a comma-separated list (e.g. <code>a,b</code>) and redeploy.
      </span>
    </>
  );
}

function Row({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="card check-row">
      <span className={`dot ${ok ? "ok" : "bad"}`} />
      <div><h3>{title}</h3><p>{children}</p></div>
    </div>
  );
}

export default function StatusPage() {
  const { profile } = useProfile();
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [proof, setProof] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setS(data);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t reach the server."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runProof() {
    if (!profile) return;
    setProof("Writing two test memories to Walrus mainnet… (can take ~20s)");
    try { setProof(JSON.stringify(await postJson("/api/proof/isolation", { code: profile.code }), null, 2)); }
    catch (e) { setProof(e instanceof Error ? e.message : "Failed"); }
  }

  const envNames = s ? Object.keys(s.env).filter((k) => k !== "MEMWAL_SERVER_URL") : [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Status</h1><p>A live setup check. If something is red, it tells you exactly which Vercel setting to fix.</p></div>
        <button className="btn ghost" onClick={load} disabled={loading}><RefreshCw size={15} /> Re-check</button>
      </div>
      {err && <div className="banner coral">{err}</div>}
      {s?.mock && <div className="banner coral"><strong>MOCK MODE</strong> — memory is NOT being written to Walrus. Remove MEMWAL_MOCK from Vercel for the real deployment.</div>}
      {loading && !s && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 76, marginBottom: 10 }} />)}
      {s && (
        <div className="checks">
          <Row ok={Boolean(s.llm?.ok)} title="AI model — Groq (the default; always used for quiz and flashcards)">
            {s.llm?.ok
              ? <>Working. Trying <code>{s.llm.model}</code> first{s.llm.verified ? " (confirmed live on Groq)" : " (couldn’t verify the model list, will retry)"} · {s.llm.candidates?.ranked.length ?? "?"} eligible models. Picked automatically, so retired or busy models can’t break the app.<Fallbacks c={s.llm.candidates} envName="GROQ_MODEL" /></>
              : <>{s.llm?.error ?? "Not working."} → set <code>GROQ_API_KEY</code> in Vercel (free key at console.groq.com/keys), then redeploy.</>}
          </Row>
          <Row ok={Boolean(s.gemini?.ok)} title="AI model — Gemini (optional second option in the Tutor and Study Room switchers)">
            {s.gemini?.ok
              ? <>Working. Trying <code>{s.gemini.model}</code> first{s.gemini.verified ? " (confirmed live on Gemini)" : " (couldn’t verify the model list, will retry)"} · {s.gemini.candidates?.ranked.length ?? "?"} eligible models. Gemini only falls back to other Gemini models — never silently to Groq.<Fallbacks c={s.gemini.candidates} envName="GEMINI_MODEL" /></>
              : <>{s.gemini?.error ?? "Not configured."} → optional: set <code>GEMINI_API_KEY</code> in Vercel (free key at aistudio.google.com), then redeploy. The Tutor works fine on Groq alone without this.</>}
          </Row>
          <Row ok={Boolean(s.memwal?.ok)} title="Walrus Memory (mainnet)">
            {s.memwal?.ok
              ? <>Connected. <strong>{s.memwal.totalMemories ?? "?"}</strong> memories on this account so far — the hackathon needs at least <strong>{s.memwal.target}</strong> written to mainnet by submission.</>
              : <>{s.memwal?.error ?? "Not connected."} → set <code>MEMWAL_PRIVATE_KEY</code> and <code>MEMWAL_ACCOUNT_ID</code> from memory.walrus.xyz, then redeploy.</>}
          </Row>
          <Row ok={Boolean(s.realtime?.ok)} title="Live Study Room (Supabase Broadcast — stores nothing)">
            {s.realtime?.ok ? <>Live wire is up (HTTP {s.realtime.status}).</> : <>{s.realtime?.error ?? `Rejected (HTTP ${s.realtime?.status}).`} → set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Vercel, then redeploy. Only the Study Room needs this.</>}
          </Row>
          {s.usage && (
            <Row ok={s.usage.ok} title="Usage on Walrus (counts only)">
              {s.usage.ok
                ? <><strong>{s.usage.privateProfiles}</strong> memory {s.usage.privateProfiles === 1 ? "key" : "keys"} and <strong>{s.usage.studyRooms}</strong> study {s.usage.studyRooms === 1 ? "room" : "rooms"} in use ({s.usage.privateMemories} private + {s.usage.roomMemories} room memories stored){s.usage.other ? <> · {s.usage.other} other namespace{s.usage.other === 1 ? "" : "s"}</> : null}{s.usage.truncated ? " · (very large account — count is partial)" : ""}. Only numbers are shown; no key or room code is ever revealed.</>
                : <>{s.usage.error}</>}
            </Row>
          )}
          {!s.devTests && <p className="tiny" style={{ margin: "0 2px" }}>Set <code>ENABLE_DEV_TESTS=true</code> in Vercel to also show usage counts and the isolation-proof button.</p>}
          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Environment variables seen by the server</h3>
            <div className="chips">
              {envNames.map((k) => <span key={k} className={`chip ${s.env[k] ? "mint" : "coral"}`}>{s.env[k] ? "✓" : "✗"} {k}</span>)}
            </div>
            <p className="tiny" style={{ marginTop: 12 }}>Relayer: <code>{String(s.env.MEMWAL_SERVER_URL)}</code> · checked {new Date(s.time).toLocaleTimeString()}</p>
          </div>
          {s.devTests && profile && (
            <div className="card" style={{ padding: 18 }}>
              <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>Walrus isolation proof (evidence for your article)</h3>
              <p className="tiny" style={{ margin: "0 0 12px" }}>Writes a private and a shared test memory to mainnet, then checks neither can see the other. Each write counts toward your 10 blobs.</p>
              <button className="btn primary" onClick={runProof}>Run proof</button>
              {proof && <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12.5, marginTop: 14, color: "var(--muted)" }}>{proof}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

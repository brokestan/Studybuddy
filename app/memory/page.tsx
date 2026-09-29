"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, RefreshCw, ShieldCheck } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { postJson, shortBlob, timeAgo, type NoteView } from "@/lib/client/api";

interface Lens {
  ok: boolean;
  recent: NoteView[];
  categories: { id: string; title: string; items: NoteView[] }[];
  stats: { mine: number | null; total: number } | null;
}
const TARGET = 10;

function Item({ n }: { n: NoteView }) {
  return (
    <div className="mem">
      {n.text}
      <div className="meta">
        {n.createdAt && <span>{timeAgo(n.createdAt)}</span>}
        <code title={n.blobId}>blob {shortBlob(n.blobId)}</code>
      </div>
    </div>
  );
}

export default function MemoryPage() {
  const { profile } = useProfile();
  const [lens, setLens] = useState<Lens | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true); setErr("");
    try { setLens(await postJson<Lens>("/api/memory/lens", { code: profile.code })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t load memory."); }
    finally { setLoading(false); }
  }, [profile]);
  useEffect(() => { load(); }, [load]);

  const mine = lens?.stats?.mine ?? 0;
  const total = lens?.stats?.total ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Memory</h1><p>Everything Buddy remembers about you, read live from Walrus. This is the same memory it uses to personalize every answer.</p></div>
        <button className="btn ghost" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
      </div>

      {err && <div className="banner coral">{err}</div>}
      {lens && !lens.ok && <div className="banner coral">Some memory lookups failed — Walrus may be slow or unreachable. Check the Status page.</div>}

      <div className="tiles">
        <div className="card tile"><div className="n">{loading && !lens ? "–" : mine}</div><div className="t">memories about you on Walrus</div></div>
        <div className="card tile">
          <div className="n">{loading && !lens ? "–" : total}</div><div className="t">memories on this whole app account (hackathon target: {TARGET}+)</div>
          <div className="bar"><i style={{ width: `${Math.min(100, (total / TARGET) * 100)}%` }} /></div>
        </div>
        <div className="card tile"><div className="t" style={{ marginTop: 0 }}><ShieldCheck size={18} style={{ color: "var(--accent)" }} /><br />Stored encrypted on Walrus mainnet. Only your memory key opens this folder.</div></div>
      </div>

      {loading && !lens && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 58, marginBottom: 8 }} />)}

      {lens && (
        <>
          {lens.categories.map((c) => (
            <div key={c.id} className="sect">
              <h2><Brain size={16} style={{ color: "var(--amber)" }} /> {c.title}</h2>
              {c.items.length ? c.items.map((n) => <Item key={n.blobId} n={n} />) : <div className="empty">Nothing here yet — it fills in as we study together.</div>}
            </div>
          ))}
          <div className="sect">
            <h2>Latest memories</h2>
            {lens.recent.length ? lens.recent.map((n) => <Item key={"r" + n.blobId} n={n} />) : <div className="empty">No memories yet. Head to the Tutor and tell Buddy what you’re studying.</div>}
          </div>
        </>
      )}
    </div>
  );
}

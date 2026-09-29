"use client";

import { useState } from "react";
import { Brain, Check, Gem, RotateCcw, Sparkles, X } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { postJson } from "@/lib/client/api";

interface Card { front: string; back: string; hint?: string }
type Phase = "setup" | "loading" | "study" | "done";
const TOPICS = ["Spanish food vocabulary", "Cell organelles", "World War II dates", "SQL commands", "Trig identities"];

export default function CardsPage() {
  const { profile } = useProfile();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(8);
  const [phase, setPhase] = useState<Phase>("setup");
  const [deck, setDeck] = useState<Card[]>([]);
  const [title, setTitle] = useState("");
  const [personal, setPersonal] = useState(0);
  const [idx, setIdx] = useState(0);
  const [flip, setFlip] = useState(false);
  const [hard, setHard] = useState<Card[]>([]);
  const [easy, setEasy] = useState<Card[]>([]);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [err, setErr] = useState("");

  async function generate() {
    if (!profile || topic.trim().length < 2) return;
    setErr(""); setPhase("loading");
    try {
      const r = await postJson<{ deck: { title: string; cards: Card[] }; personalizedFrom: string[] }>("/api/cards/generate", { code: profile.code, topic: topic.trim(), count });
      setDeck(r.deck.cards); setTitle(r.deck.title); setPersonal(r.personalizedFrom.length);
      begin(r.deck.cards);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t build the deck."); setPhase("setup"); }
  }
  function begin(cards: Card[]) { setDeck(cards); setIdx(0); setFlip(false); setHard([]); setEasy([]); setSave("idle"); setPhase("study"); }

  async function rate(known: boolean) {
    const c = deck[idx];
    const nh = known ? hard : [...hard, c];
    const ne = known ? [...easy, c] : easy;
    setHard(nh); setEasy(ne); setFlip(false);
    if (idx + 1 < deck.length) { setIdx(idx + 1); return; }
    setPhase("done"); setSave("saving");
    try {
      const r = await postJson<{ saved: boolean }>("/api/cards/review", { code: profile!.code, topic: topic.trim(), hard: nh.map((x) => x.front), easy: ne.map((x) => x.front) });
      setSave(r.saved ? "saved" : "failed");
    } catch { setSave("failed"); }
  }

  const c = deck[idx];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Flashcards</h1><p>Decks aimed at your weak spots. What you struggle with is remembered for next time.</p></div></div>

      {phase === "setup" && (
        <div className="card setup">
          <label className="lbl" style={{ marginTop: 0 }}>What do you want to memorize?</label>
          <input className="input lg" value={topic} maxLength={120} placeholder="e.g. Krebs cycle, French irregular verbs" onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} />
          <div className="chips" style={{ marginTop: 10 }}>{TOPICS.map((t) => <button key={t} className="chip suggest" onClick={() => setTopic(t)}>{t}</button>)}</div>
          <div style={{ marginTop: 20 }}><div className="tiny" style={{ marginBottom: 6 }}>Cards</div>
            <div className="seg">{[6, 8, 12].map((n) => <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n}</button>)}</div></div>
          {err && <div className="banner coral" style={{ marginTop: 16 }}>{err}</div>}
          <div style={{ marginTop: 22 }}><button className="btn primary lg" disabled={topic.trim().length < 2} onClick={generate}><Sparkles size={18} /> Build my deck</button></div>
        </div>
      )}

      {phase === "loading" && (
        <div className="card"><div className="skeleton" style={{ height: 240 }} /><p className="tiny">Recalling what you’ve struggled with and writing cards…</p></div>
      )}

      {phase === "study" && c && (
        <>
          {personal > 0 && <div className="banner mint"><Brain size={16} /> Deck tuned with {personal} thing{personal > 1 ? "s" : ""} Buddy remembers about you.</div>}
          <div className="progress"><div style={{ width: `${(idx / deck.length) * 100}%` }} /></div>
          <div className="tiny" style={{ marginBottom: 8 }}>{title} · card {idx + 1} of {deck.length}</div>
          <div className="deck">
            <div className={`flip ${flip ? "on" : ""}`} onClick={() => setFlip(!flip)} role="button" tabIndex={0} aria-label="Flip card" onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setFlip(!flip)}>
              <div className="face"><div className="term">{c.front}</div>{c.hint && <div className="hint">Hint: {c.hint}</div>}<div className="tap">tap to reveal</div></div>
              <div className="face back"><div className="ans">{c.back}</div></div>
            </div>
          </div>
          <div className="rate">
            <button className="btn ghost lg" onClick={() => rate(false)}><X size={18} /> Again</button>
            <button className="btn primary lg" onClick={() => rate(true)}><Check size={18} /> Got it</button>
          </div>
        </>
      )}

      {phase === "done" && (
        <div className="card qcard">
          <h2 className="display" style={{ margin: "0 0 6px", fontSize: 26 }}>{hard.length === 0 ? "You knew them all!" : `${easy.length} of ${deck.length} down`}</h2>
          {hard.length > 0 && <p style={{ color: "var(--muted)" }}><strong style={{ color: "var(--coral)" }}>Needs another pass:</strong> {hard.map((h) => h.front).join(" · ")}</p>}
          <div className="chips" style={{ margin: "14px 0" }}>
            {save === "saving" && <span className="chip quiet">Sealing to Walrus…</span>}
            {save === "saved" && <span className="chip mint"><Gem size={13} /> Saved — next deck will focus on these</span>}
            {save === "failed" && <span className="chip coral">Couldn’t save to memory</span>}
          </div>
          <div className="row gap wrap">
            {hard.length > 0 && <button className="btn primary" onClick={() => begin(hard)}><RotateCcw size={16} /> Review the hard ones</button>}
            <button className="btn ghost" onClick={() => setPhase("setup")}>New deck</button>
          </div>
        </div>
      )}
    </div>
  );
}

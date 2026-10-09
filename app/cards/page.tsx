"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, Flame, Gem, RotateCcw, Sparkles, X } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { postJson, timeAgo } from "@/lib/client/api";
import type { CardsHistoryItem } from "@/lib/history";

interface Card { front: string; back: string; hint?: string }
type Grade = "again" | "hard" | "good" | "easy";
type Phase = "setup" | "loading" | "study" | "done";
interface QueueItem { card: Card; requeues: number }
const TOPICS = ["Spanish food vocabulary", "Cell organelles", "World War II dates", "SQL commands", "Trig identities"];
// A card can be requeued (shown again this same session) at most this many
// times — "Again" every time forever would never end the deck.
const MAX_REQUEUES = 2;

export default function CardsPage() {
  const { profile } = useProfile();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(8);
  const [phase, setPhase] = useState<Phase>("setup");
  const [title, setTitle] = useState("");
  const [personal, setPersonal] = useState(0);
  // The stable, never-mutated original set of cards for this deck — used to
  // look cards back up by name after the session ends (e.g. "review the
  // tough ones"). `queue` below changes constantly as cards get reordered
  // and requeued, so it must never be used for that lookup.
  const [originalDeck, setOriginalDeck] = useState<Card[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [retired, setRetired] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [flip, setFlip] = useState(false);
  const [finalGrades, setFinalGrades] = useState<Record<Grade, string[]> | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [err, setErr] = useState("");
  const gradeMapRef = useRef<Record<string, Grade>>({});

  const [history, setHistory] = useState<CardsHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (!profile) return;
    setHistoryLoading(true);
    try {
      const r = await postJson<{ decks: CardsHistoryItem[] }>("/api/history", { code: profile.code });
      setHistory(r.decks);
    } catch {
      /* history is a nice-to-have; a failed fetch just leaves the list empty */
    } finally {
      setHistoryLoading(false);
    }
  }, [profile]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function generate() {
    if (!profile || topic.trim().length < 2) return;
    setErr(""); setPhase("loading");
    try {
      const r = await postJson<{ deck: { title: string; cards: Card[] }; personalizedFrom: string[] }>("/api/cards/generate", { code: profile.code, topic: topic.trim(), count });
      setTitle(r.deck.title); setPersonal(r.personalizedFrom.length);
      begin(r.deck.cards);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t build the deck."); setPhase("setup"); }
  }

  function begin(cards: Card[]) {
    gradeMapRef.current = {};
    setOriginalDeck(cards);
    setQueue(cards.map((card) => ({ card, requeues: 0 })));
    setTotalCards(cards.length);
    setRetired(0);
    setFlip(false);
    setFinalGrades(null);
    setSave("idle");
    setPhase("study");
  }

  async function finish(gradeMap: Record<string, Grade>) {
    const buckets: Record<Grade, string[]> = { again: [], hard: [], good: [], easy: [] };
    for (const [front, g] of Object.entries(gradeMap)) buckets[g].push(front);
    setFinalGrades(buckets);
    setPhase("done"); setSave("saving");
    try {
      const r = await postJson<{ saved: boolean }>("/api/cards/review", { code: profile!.code, topic: topic.trim(), ...buckets });
      setSave(r.saved ? "saved" : "failed");
      if (r.saved) loadHistory();
    } catch { setSave("failed"); }
  }

  function gradeCard(g: Grade) {
    if (!queue.length) return;
    const cur = queue[0];
    const rest = queue.slice(1);
    gradeMapRef.current = { ...gradeMapRef.current, [cur.card.front]: g };
    setFlip(false);

    const mustRetire = g === "good" || g === "easy" || cur.requeues >= MAX_REQUEUES;
    if (mustRetire) {
      setRetired((r) => r + 1);
      setQueue(rest);
      if (rest.length === 0) finish(gradeMapRef.current);
      return;
    }
    // "Again" resurfaces soon (a couple cards later); "Hard" resurfaces later
    // in the same session — both stay in THIS deck rather than waiting for a
    // whole new generated deck, which is the point of grading richer than a
    // binary got-it/didn't.
    const item: QueueItem = { card: cur.card, requeues: cur.requeues + 1 };
    const insertAt = g === "again" ? Math.min(2, rest.length) : rest.length;
    setQueue([...rest.slice(0, insertAt), item, ...rest.slice(insertAt)]);
  }

  function retake(t: string) {
    setTopic(t);
    setPhase("setup");
  }
  function reviewAgain(fronts: string[]) {
    const cards = fronts.map((f) => originalDeck.find((c) => c.front === f)).filter((c): c is Card => c !== undefined);
    if (cards.length) begin(cards);
  }

  const c = queue[0]?.card;

  return (
    <div className="page">
      <div className="page-head"><div><h1>Flashcards</h1><p>Decks aimed at your weak spots. What you struggle with is remembered for next time.</p></div></div>

      {phase === "setup" && (
        <>
          <div className="card setup">
            <label className="lbl" style={{ marginTop: 0 }}>What do you want to memorize?</label>
            <input className="input lg" value={topic} maxLength={120} placeholder="e.g. Krebs cycle, French irregular verbs" onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} />
            <div className="chips" style={{ marginTop: 10 }}>{TOPICS.map((t) => <button key={t} className="chip suggest" onClick={() => setTopic(t)}>{t}</button>)}</div>
            <div style={{ marginTop: 20 }}><div className="tiny" style={{ marginBottom: 6 }}>Cards</div>
              <div className="seg">{[6, 8, 12].map((n) => <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n}</button>)}</div></div>
            {err && <div className="banner coral" style={{ marginTop: 16 }}>{err}</div>}
            <div style={{ marginTop: 22 }}><button className="btn primary lg" disabled={topic.trim().length < 2} onClick={generate}><Sparkles size={18} /> Build my deck</button></div>
          </div>

          {historyLoading && <div className="skeleton" style={{ height: 64, marginTop: 16 }} />}
          {!historyLoading && history.length > 0 && (
            <div className="sect" style={{ marginTop: 24 }}>
              <h2><Clock size={16} style={{ color: "var(--amber)" }} /> Recent decks</h2>
              {history.slice(0, 6).map((h) => (
                <div key={h.blobId} className="mem hist-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row gap wrap">
                      <strong>{h.topic}</strong>
                      {h.again.length > 0 && <span className="chip coral">{h.again.length} still shaky</span>}
                      {h.hard.length > 0 && <span className="chip amber">{h.hard.length} need practice</span>}
                      {h.easy.length > 0 && <span className="chip mint">{h.easy.length} knows cold</span>}
                      {h.createdAt && <span className="tiny">{timeAgo(h.createdAt)}</span>}
                    </div>
                    {h.again.length > 0 && <div className="tiny" style={{ marginTop: 6 }}><span style={{ color: "var(--coral)" }}>Still shaky:</span> {h.again.join(" · ")}</div>}
                  </div>
                  <button className="btn ghost" onClick={() => retake(h.topic)}><RotateCcw size={14} /> Retake</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {phase === "loading" && (
        <div className="card"><div className="skeleton" style={{ height: 240 }} /><p className="tiny">Recalling what you’ve struggled with and writing cards…</p></div>
      )}

      {phase === "study" && c && (
        <>
          {personal > 0 && <div className="banner mint"><Flame size={16} /> Deck tuned with {personal} thing{personal > 1 ? "s" : ""} Buddy remembers about you.</div>}
          <div className="progress"><div style={{ width: `${(retired / totalCards) * 100}%` }} /></div>
          <div className="tiny" style={{ marginBottom: 8 }}>{title} · {retired} of {totalCards} learned{queue.length > totalCards - retired ? " · some cards are circling back for another look" : ""}</div>
          <div className="deck">
            <div className={`flip ${flip ? "on" : ""}`} onClick={() => setFlip(!flip)} role="button" tabIndex={0} aria-label="Flip card" onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setFlip(!flip)}>
              <div className="face"><div className="term">{c.front}</div>{c.hint && <div className="hint">Hint: {c.hint}</div>}<div className="tap">tap to reveal</div></div>
              <div className="face back"><div className="ans">{c.back}</div></div>
            </div>
          </div>
          <p className="tiny" style={{ textAlign: "center", marginBottom: 8 }}>How well did you know it?</p>
          <div className="rate4">
            <button className="rate-btn again" onClick={() => gradeCard("again")}><X size={16} /> Again</button>
            <button className="rate-btn hard" onClick={() => gradeCard("hard")}><AlertTriangle size={16} /> Hard</button>
            <button className="rate-btn good" onClick={() => gradeCard("good")}><Check size={16} /> Good</button>
            <button className="rate-btn easy" onClick={() => gradeCard("easy")}><Sparkles size={16} /> Easy</button>
          </div>
        </>
      )}

      {phase === "done" && finalGrades && (
        <div className="card qcard">
          <h2 className="display" style={{ margin: "0 0 6px", fontSize: 26 }}>
            {finalGrades.again.length === 0 && finalGrades.hard.length === 0 ? "You knew them all!" : `${finalGrades.good.length + finalGrades.easy.length} of ${totalCards} solid`}
          </h2>
          {finalGrades.again.length > 0 && <p style={{ color: "var(--muted)", margin: "0 0 4px" }}><strong style={{ color: "var(--coral)" }}>Still shaky:</strong> {finalGrades.again.join(" · ")}</p>}
          {finalGrades.hard.length > 0 && <p style={{ color: "var(--muted)", margin: "0 0 4px" }}><strong style={{ color: "var(--amber)" }}>Needs more practice:</strong> {finalGrades.hard.join(" · ")}</p>}
          {finalGrades.easy.length > 0 && <p style={{ color: "var(--muted)", margin: 0 }}><strong style={{ color: "var(--accent)" }}>Knows cold:</strong> {finalGrades.easy.join(" · ")}</p>}
          <div className="chips" style={{ margin: "14px 0" }}>
            {save === "saving" && <span className="chip quiet">Sealing to Walrus…</span>}
            {save === "saved" && <span className="chip mint"><Gem size={13} /> Saved — next deck will target exactly these</span>}
            {save === "failed" && <span className="chip coral">Couldn’t save to memory</span>}
          </div>
          <div className="row gap wrap">
            {(finalGrades.again.length > 0 || finalGrades.hard.length > 0) && (
              <button className="btn primary" onClick={() => reviewAgain([...finalGrades.again, ...finalGrades.hard])}><RotateCcw size={16} /> Review the tough ones</button>
            )}
            <button className="btn ghost" onClick={() => setPhase("setup")}>New deck</button>
          </div>
        </div>
      )}
    </div>
  );
}

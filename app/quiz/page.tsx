"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Check, Clock, Gem, MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { postJson, timeAgo, type SourceView } from "@/lib/client/api";
import type { QuizHistoryItem } from "@/lib/history";

interface Q { q: string; options: string[]; answerIndex: number; explanation: string; concept: string }
interface Quiz { title: string; questions: Q[] }
type Phase = "setup" | "loading" | "play" | "done";
const TOPICS = ["The French Revolution", "Photosynthesis", "Derivatives (calculus)", "Python loops", "Supply and demand"];

export default function QuizPage() {
  const { profile } = useProfile();
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [phase, setPhase] = useState<Phase>("setup");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [personal, setPersonal] = useState<string[]>([]);
  const [sources, setSources] = useState<SourceView[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [results, setResults] = useState<{ concept: string; correct: boolean }[]>([]);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [err, setErr] = useState("");

  const [history, setHistory] = useState<QuizHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (!profile) return;
    setHistoryLoading(true);
    try {
      const r = await postJson<{ quizzes: QuizHistoryItem[] }>("/api/history", { code: profile.code });
      setHistory(r.quizzes);
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
      const r = await postJson<{ quiz: Quiz; personalizedFrom: string[]; sources: SourceView[] }>("/api/quiz/generate", { code: profile.code, topic: topic.trim(), count, difficulty });
      setQuiz(r.quiz); setPersonal(r.personalizedFrom); setSources(r.sources);
      setIdx(0); setPicked(null); setResults([]); setSave("idle"); setPhase("play");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t build the quiz."); setPhase("setup");
    }
  }

  function pick(i: number) {
    if (!quiz || picked !== null) return;
    const q = quiz.questions[idx];
    setPicked(i);
    setResults((r) => [...r, { concept: q.concept, correct: i === q.answerIndex }]);
  }

  async function next() {
    if (!quiz || !profile) return;
    if (idx + 1 < quiz.questions.length) { setIdx(idx + 1); setPicked(null); return; }
    setPhase("done"); setSave("saving");
    try {
      const r = await postJson<{ saved: boolean }>("/api/quiz/submit", { code: profile.code, topic: topic.trim(), results });
      setSave(r.saved ? "saved" : "failed");
      if (r.saved) loadHistory();
    } catch { setSave("failed"); }
  }

  function retake(t: string) {
    setTopic(t);
    setPhase("setup");
  }

  const total = quiz?.questions.length ?? 0;
  const right = results.filter((r) => r.correct).length;
  const missed = [...new Set(results.filter((r) => !r.correct).map((r) => r.concept))];
  const strong = [...new Set(results.filter((r) => r.correct).map((r) => r.concept))].filter((c) => !missed.includes(c));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Quiz</h1><p>Questions built around what Buddy remembers you struggle with. Results are saved to your Walrus memory.</p></div>
      </div>

      {phase === "setup" && (
        <>
          <div className="card setup">
            <label className="lbl" style={{ marginTop: 0 }}>What do you want to be quizzed on?</label>
            <input className="input lg" value={topic} maxLength={120} placeholder="e.g. Cell biology, the Cold War, quadratic equations" onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} />
            <div className="chips" style={{ marginTop: 10 }}>
              {TOPICS.map((t) => <button key={t} className="chip suggest" onClick={() => setTopic(t)}>{t}</button>)}
            </div>
            <div className="row gap wrap" style={{ marginTop: 20 }}>
              <div><div className="tiny" style={{ marginBottom: 6 }}>Questions</div>
                <div className="seg">{[3, 5, 8].map((n) => <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n}</button>)}</div></div>
              <div><div className="tiny" style={{ marginBottom: 6 }}>Difficulty</div>
                <div className="seg">{(["easy", "medium", "hard"] as const).map((d) => <button key={d} className={difficulty === d ? "on" : ""} onClick={() => setDifficulty(d)}>{d}</button>)}</div></div>
            </div>
            {err && <div className="banner coral" style={{ marginTop: 16 }}>{err}</div>}
            <div style={{ marginTop: 22 }}>
              <button className="btn primary lg" disabled={topic.trim().length < 2} onClick={generate}><Sparkles size={18} /> Build my quiz</button>
            </div>
          </div>

          {historyLoading && <div className="skeleton" style={{ height: 64, marginTop: 16 }} />}
          {!historyLoading && history.length > 0 && (
            <div className="sect" style={{ marginTop: 24 }}>
              <h2><Clock size={16} style={{ color: "var(--amber)" }} /> Recent quizzes</h2>
              {history.slice(0, 6).map((h) => {
                const pct = h.total ? h.right / h.total : 0;
                return (
                  <div key={h.blobId} className="mem hist-row">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row gap wrap">
                        <strong>{h.topic}</strong>
                        <span className={`chip ${pct >= 0.7 ? "mint" : pct >= 0.4 ? "amber" : "coral"}`}>{h.right}/{h.total}</span>
                        {h.createdAt && <span className="tiny">{timeAgo(h.createdAt)}</span>}
                      </div>
                      {h.missed.length > 0 && <div className="tiny" style={{ marginTop: 6 }}><span style={{ color: "var(--coral)" }}>Revisit:</span> {h.missed.join(", ")}</div>}
                    </div>
                    <button className="btn ghost" onClick={() => retake(h.topic)}><RotateCcw size={14} /> Retake</button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {phase === "loading" && (
        <div className="card">
          <div className="skeleton" style={{ height: 26, width: "70%", marginBottom: 14 }} />
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 52, marginBottom: 10 }} />)}
          <p className="tiny">Recalling your weak spots from Walrus and writing questions…</p>
        </div>
      )}

      {phase === "play" && quiz && (
        <>
          {personal.length > 0 && (
            <div className="banner mint"><Brain size={16} /> Tailored using {personal.length} thing{personal.length > 1 ? "s" : ""} Buddy remembers about you.</div>
          )}
          <div className="progress"><div style={{ width: `${((idx + (picked !== null ? 1 : 0)) / total) * 100}%` }} /></div>
          <div className="card qcard">
            <div className="qmeta">{quiz.title} · Question {idx + 1} of {total} · {quiz.questions[idx].concept}</div>
            <h2 className="qtext">{quiz.questions[idx].q}</h2>
            <div className="opts">
              {quiz.questions[idx].options.map((o, i) => {
                const q = quiz.questions[idx];
                const cls = picked === null ? "" : i === q.answerIndex ? "good" : i === picked ? "bad" : "";
                return (
                  <button key={i} className={`opt ${cls}`} disabled={picked !== null} onClick={() => pick(i)}>
                    <span className="k">{picked !== null && i === q.answerIndex ? <Check size={14} /> : picked === i ? <X size={14} /> : "ABCD"[i]}</span>{o}
                  </button>
                );
              })}
            </div>
            {picked !== null && (
              <>
                <div className="explain"><strong>{picked === quiz.questions[idx].answerIndex ? "Correct. " : "Not quite. "}</strong>{quiz.questions[idx].explanation}</div>
                <div style={{ marginTop: 18 }}><button className="btn primary" onClick={next}>{idx + 1 < total ? "Next question" : "See my results"}</button></div>
              </>
            )}
          </div>
        </>
      )}

      {phase === "done" && quiz && (
        <div className="card qcard">
          <div className="result">
            <div className="ring">
              <svg width="150" height="150" viewBox="0 0 150 150">
                <circle cx="75" cy="75" r="64" fill="none" stroke="var(--surface-2)" strokeWidth="12" />
                <circle cx="75" cy="75" r="64" fill="none" stroke="var(--accent)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(right / total) * 402} 402`} />
              </svg>
              <div className="num">{right}/{total}</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2 className="display" style={{ margin: "0 0 8px", fontSize: 26 }}>{right === total ? "Perfect round!" : right >= total / 2 ? "Solid work." : "Good — now we know where to focus."}</h2>
              {missed.length > 0 && <p style={{ margin: "0 0 6px", color: "var(--muted)" }}><strong style={{ color: "var(--coral)" }}>Revisit:</strong> {missed.join(", ")}</p>}
              {strong.length > 0 && <p style={{ margin: 0, color: "var(--muted)" }}><strong style={{ color: "var(--accent)" }}>Strong:</strong> {strong.join(", ")}</p>}
            </div>
          </div>
          <div className="chips" style={{ marginTop: 20 }}>
            {save === "saving" && <span className="chip quiet">Sealing result to Walrus…</span>}
            {save === "saved" && <span className="chip mint"><Gem size={13} /> Saved to your Walrus memory — Buddy will use this next time</span>}
            {save === "failed" && <span className="chip coral">Couldn’t save to memory (check Status page)</span>}
          </div>
          {sources.length > 0 && <div className="sources">{sources.map((s) => <a key={s.url} className="source" href={s.url} target="_blank" rel="noreferrer noopener">{s.title} · Wikipedia</a>)}</div>}
          <div className="row gap wrap" style={{ marginTop: 22 }}>
            <button className="btn primary" onClick={() => { setPhase("setup"); setQuiz(null); }}><RotateCcw size={16} /> New quiz</button>
            {missed.length > 0 && (
              <button className="btn ghost" onClick={() => { try { sessionStorage.setItem("sb.prefill", `Help me understand these topics I just missed on my ${topic} quiz: ${missed.join(", ")}.`); } catch { /* ignore */ } router.push("/"); }}>
                <MessageCircle size={16} /> Ask Buddy to explain my misses
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

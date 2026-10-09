"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowUp, BookOpen, Brain, RotateCcw } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { useTutorSession, type TutorMsg, type TutorOpener } from "@/components/TutorSessionProvider";
import { Markdown } from "@/components/Markdown";
import { MemoryTrace } from "@/components/MemoryTrace";
import { Logo } from "@/components/Logo";
import { postJson, streamTutor, timeAgo, type Provider } from "@/lib/client/api";
import type { Level } from "@/lib/prompts";

const LEVELS: { id: Level; label: string }[] = [
  { id: "eli5", label: "Like I’m 8" },
  { id: "middle", label: "Middle school" },
  { id: "high", label: "High school" },
  { id: "college", label: "College" },
  { id: "expert", label: "Expert" },
];
const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "groq", label: "Groq (Qwen)" },
  { id: "gemini", label: "Gemini" },
];
const QUICK = ["Explain that more simply", "Give me a practice question", "Summarize what we covered", "What are my weak spots?"];

export default function TutorPage() {
  const { profile } = useProfile();
  const {
    msgs, setMsgs, opener, setOpener, openerErr, setOpenerErr, openerFetched, markOpenerFetched,
    level, setLevel, provider, setProvider, busy, setBusy, input, setInput, resetSession,
  } = useTutorSession();
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Personalized greeting built from what Walrus remembers. Only runs once per
  // session (openerFetched) — coming back from Quiz/Cards/Room/Memory/Status
  // must not re-fetch and overwrite an already-underway conversation.
  // Counts opener requests so only the NEWEST one may apply its result (e.g. after
  // "New chat"). Crucially, the result is NOT tied to this effect's cleanup:
  // markOpenerFetched() below changes `openerFetched`, which re-runs this effect,
  // and a cleanup-based "alive" flag would then throw the greeting away on arrival
  // — leaving "checking what Walrus remembers…" on screen forever. The state lives
  // in the session provider, so applying it after a re-render is safe.
  const openerReq = useRef(0);
  useEffect(() => {
    if (!profile || openerFetched || msgs.length > 0) return;
    const id = ++openerReq.current;
    markOpenerFetched();
    // The server caps its own waits, but a cold start can delay the request
    // itself. After 25s give up on the personalised greeting and show the plain one.
    const ctl = new AbortController();
    const giveUp = setTimeout(() => ctl.abort(), 25_000);
    postJson<TutorOpener>("/api/tutor/open", { code: profile.code, name: profile.name }, ctl.signal)
      .then((o) => { if (openerReq.current === id) setOpener(o); })
      .catch(() => { if (openerReq.current === id) setOpenerErr(true); })
      .finally(() => clearTimeout(giveUp));
    try {
      const pre = sessionStorage.getItem("sb.prefill");
      if (pre) {
        setInput(pre);
        sessionStorage.removeItem("sb.prefill");
      }
    } catch { /* ignore */ }
  }, [profile, openerFetched, msgs.length, markOpenerFetched, setOpener, setOpenerErr, setInput]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!profile || !message || busy) return;
      const history = msgs.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content })).slice(-12);
      const aid = crypto.randomUUID();
      setMsgs((p) => [...p, { id: crypto.randomUUID(), role: "user", content: message }, { id: aid, role: "assistant", content: "", streaming: true, step: "recall" }]);
      setInput("");
      if (taRef.current) taRef.current.style.height = "auto";
      setBusy(true);
      const patch = (f: (m: TutorMsg) => TutorMsg) => setMsgs((p) => p.map((m) => (m.id === aid ? f(m) : m)));
      try {
        await streamTutor({ code: profile.code, name: profile.name, message, history, level, provider }, (ev) => {
          switch (ev.type) {
            case "status": patch((m) => ({ ...m, step: ev.step })); break;
            case "model": patch((m) => ({ ...m, provider: ev.provider, model: ev.model })); break;
            case "meta": patch((m) => ({ ...m, recalled: ev.recalled, sources: ev.sources, memoryOk: ev.memoryOk, provider: ev.provider, model: ev.model })); break;
            case "token": patch((m) => ({ ...m, content: m.content + ev.t })); break;
            case "done": patch((m) => ({ ...m, learned: ev.learned, sealError: ev.sealError, topic: ev.topic, step: null, streaming: false })); break;
            case "error": patch((m) => ({ ...m, error: ev.message, step: null, streaming: false })); break;
          }
        });
      } catch (e) {
        patch((m) => ({ ...m, error: e instanceof Error ? e.message : "Something went wrong.", step: null, streaming: false }));
      } finally {
        patch((m) => ({ ...m, streaming: false, step: null }));
        setBusy(false);
      }
    },
    [profile, msgs, busy, level, provider, setMsgs, setInput, setBusy]
  );

  const empty = msgs.length === 0;
  // Did the AI actually change partway through this conversation? Shown as a
  // small note so the "memory survives a model swap" proof is unmissable.
  const providersUsed = new Set(msgs.filter((m) => m.role === "assistant" && m.provider).map((m) => m.provider));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tutor</h1>
          <p>Ask anything. Buddy explains it your way, and remembers what you learn.</p>
        </div>
        <div className="row gap wrap" style={{ justifyContent: "flex-end" }}>
          {!empty && (
            <button className="btn ghost" onClick={resetSession} title="Clear this chat window (your memory on Walrus is untouched)">
              <RotateCcw size={15} /> New chat
            </button>
          )}
          <div className="seg" role="group" aria-label="AI model">
            {PROVIDERS.map((pr) => (
              <button key={pr.id} className={provider === pr.id ? "on" : ""} onClick={() => setProvider(pr.id)} title="You can switch this anytime, even mid-conversation — your Walrus memory doesn't belong to either one">{pr.label}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Explanation level">
            {LEVELS.map((l) => (
              <button key={l.id} className={level === l.id ? "on" : ""} onClick={() => setLevel(l.id)}>{l.label}</button>
            ))}
          </div>
        </div>
      </div>
      {providersUsed.size > 1 && (
        <div className="banner mint" style={{ marginBottom: 14 }}>
          <Brain size={16} /> This conversation has used more than one AI model — notice Buddy still remembers everything, because that memory lives on Walrus, not inside Groq or Gemini.
        </div>
      )}

      <div className="thread">
        {empty && (
          <div className="card opener">
            {!opener && !openerErr && (
              <>
                <div className="skeleton" style={{ height: 30, width: "80%", marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 30, width: "55%" }} />
                <p className="tiny" style={{ marginTop: 16 }}>Checking what Walrus remembers about you…</p>
              </>
            )}
            {openerErr && <p className="display">Hi {profile?.name}! What are we studying today?</p>}
            {opener && (
              <>
                <p className="display">{opener.greeting}</p>
                {!opener.memoryOk && <div className="banner coral">Walrus memory is unreachable right now — I can still teach, but I won’t remember this session. Check the Status page.</div>}
                {opener.notes.length > 0 && (
                  <>
                    <div className="label"><Brain size={12} style={{ verticalAlign: "-1px" }} /> What I remember</div>
                    <div className="chips">
                      {opener.notes.slice(0, 4).map((n) => (
                        <span key={n.blobId} className="chip amber" title={n.text}>
                          {n.text.length > 64 ? n.text.slice(0, 62) + "…" : n.text} {n.createdAt && <em style={{ opacity: 0.7, fontStyle: "normal" }}>· {timeAgo(n.createdAt)}</em>}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <div className="label">Try</div>
                <div className="chips">
                  {opener.suggestions.map((s) => (
                    <button key={s} className="chip suggest" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="msg user"><div className="bubble-user">{m.content}</div></div>
          ) : (
            <div key={m.id} className="msg bot">
              <div className="avatar-bot"><Logo size={30} /></div>
              <div className="bot-body">
                {m.content ? (
                  <div className={m.streaming ? "caret" : ""}><Markdown>{m.content}</Markdown></div>
                ) : !m.error ? (
                  <div className="skeleton" style={{ height: 18, width: 220 }} />
                ) : null}
                {m.error && <div className="banner coral">{m.error}</div>}
                {m.model && !m.error && <div className="tiny" style={{ marginTop: 6 }}>via {m.model}</div>}
                {m.sources && m.sources.length > 0 && (
                  <div className="sources">
                    {m.sources.map((s, i) => (
                      <a key={s.url} className="source" href={s.url} target="_blank" rel="noreferrer noopener">[{i + 1}] {s.title} · Wikipedia</a>
                    ))}
                  </div>
                )}
                {!m.error && <MemoryTrace recalled={m.recalled} learned={m.learned} step={m.step} memoryOk={m.memoryOk ?? true} sealError={m.sealError} />}
                {m.topic && (
                  <div className="chips" style={{ marginTop: 8 }}>
                    <span className="chip mint"><BookOpen size={12} /> logged under {m.topic.subject} — {m.topic.topic}</span>
                  </div>
                )}
              </div>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        <div className="composer-tools">
          <div className="quick">
            {QUICK.map((q) => (
              <button key={q} className="chip suggest" disabled={busy} onClick={() => send(q)}>{q}</button>
            ))}
          </div>
        </div>
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder="Ask a question, paste your notes, or say what you’re studying…"
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
          />
          <button className="send" disabled={busy || !input.trim()} aria-label="Send"><ArrowUp size={20} /></button>
        </form>
      </div>
    </div>
  );
}

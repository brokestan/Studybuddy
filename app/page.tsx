"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Brain } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { Markdown } from "@/components/Markdown";
import { MemoryTrace, type Step } from "@/components/MemoryTrace";
import { Logo } from "@/components/Logo";
import { postJson, streamTutor, timeAgo, type NoteView, type SourceView } from "@/lib/client/api";
import type { Level } from "@/lib/prompts";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  recalled?: NoteView[];
  sources?: SourceView[];
  learned?: string[];
  memoryOk?: boolean;
  sealError?: string;
  step?: Step;
  streaming?: boolean;
  error?: string;
}
interface Opener {
  returning: boolean;
  greeting: string;
  suggestions: string[];
  notes: NoteView[];
  memoryOk: boolean;
}

const LEVELS: { id: Level; label: string }[] = [
  { id: "eli5", label: "Like I’m 8" },
  { id: "middle", label: "Middle school" },
  { id: "high", label: "High school" },
  { id: "college", label: "College" },
  { id: "expert", label: "Expert" },
];
const QUICK = ["Explain that more simply", "Give me a practice question", "Summarize what we covered", "What are my weak spots?"];

export default function TutorPage() {
  const { profile } = useProfile();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<Level>("high");
  const [opener, setOpener] = useState<Opener | null>(null);
  const [openerErr, setOpenerErr] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Personalized greeting built from what Walrus remembers.
  useEffect(() => {
    if (!profile) return;
    let alive = true;
    postJson<Opener>("/api/tutor/open", { code: profile.code, name: profile.name })
      .then((o) => alive && setOpener(o))
      .catch(() => alive && setOpenerErr(true));
    try {
      const pre = sessionStorage.getItem("sb.prefill");
      if (pre) {
        setInput(pre);
        sessionStorage.removeItem("sb.prefill");
      }
    } catch { /* ignore */ }
    return () => { alive = false; };
  }, [profile]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs.length]);
  useEffect(() => {
    if (busy) endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

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
      const patch = (f: (m: Msg) => Msg) => setMsgs((p) => p.map((m) => (m.id === aid ? f(m) : m)));
      try {
        await streamTutor({ code: profile.code, name: profile.name, message, history, level }, (ev) => {
          switch (ev.type) {
            case "status": patch((m) => ({ ...m, step: ev.step })); break;
            case "meta": patch((m) => ({ ...m, recalled: ev.recalled, sources: ev.sources, memoryOk: ev.memoryOk })); break;
            case "token": patch((m) => ({ ...m, content: m.content + ev.t })); break;
            case "done": patch((m) => ({ ...m, learned: ev.learned, sealError: ev.sealError, step: null, streaming: false })); break;
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
    [profile, msgs, busy, level]
  );

  const empty = msgs.length === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tutor</h1>
          <p>Ask anything. Buddy explains it your way, and remembers what you learn.</p>
        </div>
        <div className="seg" role="group" aria-label="Explanation level">
          {LEVELS.map((l) => (
            <button key={l.id} className={level === l.id ? "on" : ""} onClick={() => setLevel(l.id)}>{l.label}</button>
          ))}
        </div>
      </div>

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
                {m.sources && m.sources.length > 0 && (
                  <div className="sources">
                    {m.sources.map((s, i) => (
                      <a key={s.url} className="source" href={s.url} target="_blank" rel="noreferrer noopener">[{i + 1}] {s.title} · Wikipedia</a>
                    ))}
                  </div>
                )}
                {!m.error && <MemoryTrace recalled={m.recalled} learned={m.learned} step={m.step} memoryOk={m.memoryOk ?? true} sealError={m.sealError} />}
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

"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadUser,
  startNewProfile,
  restoreProfile,
  forgetProfile,
  type StudyBuddyUser,
} from "@/lib/id";

interface Turn {
  role: "user" | "assistant";
  content: string;
  recalled?: { text: string; distance: number }[];
  learned?: string[];
}

type IntakeMode = null | "fresh" | "restore";

export default function Page() {
  const [user, setUser] = useState<StudyBuddyUser | null>(null);
  const [mode, setMode] = useState<IntakeMode>(null);
  const [nameInput, setNameInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBadge, setOpenBadge] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUser(loadUser());
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, sending]);

  function handleFreshSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameInput.trim()) return;
    setUser(startNewProfile(nameInput));
  }

  function handleRestoreSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codeInput.trim() || !nameInput.trim()) return;
    setUser(restoreProfile(codeInput, nameInput));
  }

  function handleCopy() {
    if (!user) return;
    navigator.clipboard?.writeText(user.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function sendMessage() {
    if (!user || !draft.trim() || sending) return;
    const message = draft.trim();
    const nextTurns: Turn[] = [...turns, { role: "user", content: message }];
    setTurns(nextTurns);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: user.code,
          message,
          history: nextTurns.map((t) => ({ role: t.role, content: t.content })),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const data = await res.json();
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          recalled: data.recalled,
          learned: data.learned,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className="shell">
      <div className="header">
        <nav className="nav">
          <a className="active" href="/">Private tutor</a>
          <a href="/room">Study room</a>
        </nav>
        <h1 className="serif">Study Buddy</h1>
        <p>
          A tutor that keeps a real, persistent memory of you — stored on
          Walrus Memory, not just this browser. Your memory code follows you
          to any device.
        </p>
        {user && (
          <div className="namebar">
            <span>
              Studying as {user.name} · memory code:{" "}
              <code className="code-pill" onClick={handleCopy} title="Click to copy">
                {user.code}
              </code>{" "}
              {copied && <span style={{ color: "var(--learned)" }}>copied!</span>}
            </span>
            <button
              onClick={() => {
                forgetProfile();
                setUser(null);
                setMode(null);
                setTurns([]);
                setNameInput("");
                setCodeInput("");
              }}
            >
              Switch profile
            </button>
          </div>
        )}
      </div>

      {!user && mode === null && (
        <div className="intake">
          <label>Is this your first time here, or are you coming back on a new device?</label>
          <div className="intake-choice">
            <button onClick={() => setMode("fresh")}>I&apos;m new here</button>
            <button onClick={() => setMode("restore")}>I have a memory code</button>
          </div>
        </div>
      )}

      {!user && mode === "fresh" && (
        <div className="intake">
          <label htmlFor="name">What should I call you?</label>
          <form onSubmit={handleFreshSubmit}>
            <input
              id="name"
              type="text"
              placeholder="e.g. Sam"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
            />
            <button type="submit" className="cta">Start</button>
          </form>
          <p className="hint">
            You&apos;ll get a memory code right after this — save it, it&apos;s the only
            way to pick up the same memory on another device later.
          </p>
        </div>
      )}

      {!user && mode === "restore" && (
        <div className="intake">
          <label htmlFor="code">Your memory code</label>
          <form onSubmit={handleRestoreSubmit}>
            <input
              id="code"
              type="text"
              placeholder="e.g. k7pq-x2mv-9htn-w4cd"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              autoFocus
            />
          </form>
          <label htmlFor="name2" style={{ marginTop: 10 }}>What should I call you?</label>
          <form onSubmit={handleRestoreSubmit}>
            <input
              id="name2"
              type="text"
              placeholder="e.g. Sam"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <button type="submit" className="cta">Continue</button>
          </form>
        </div>
      )}

      {user && (
        <>
          <div className="log" ref={logRef}>
            {turns.length === 0 && (
              <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>
                Tell me what you&apos;re studying, or ask a question, to get started.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`turn ${t.role === "user" ? "user" : "bot"}`}>
                <div className="bubble">{t.content}</div>
                {t.role === "assistant" && ((t.recalled && t.recalled.length > 0) || (t.learned && t.learned.length > 0)) && (
                  <div className="badges">
                    {t.recalled && t.recalled.length > 0 && (
                      <span
                        className="badge recall"
                        onClick={() => setOpenBadge(openBadge === i * 2 ? null : i * 2)}
                        style={{ cursor: "pointer" }}
                      >
                        🖍 recalled {t.recalled.length} {t.recalled.length === 1 ? "memory" : "memories"}
                      </span>
                    )}
                    {t.learned && t.learned.length > 0 && (
                      <span
                        className="badge learned"
                        onClick={() => setOpenBadge(openBadge === i * 2 + 1 ? null : i * 2 + 1)}
                        style={{ cursor: "pointer" }}
                      >
                        🌱 learned {t.learned.length} new {t.learned.length === 1 ? "fact" : "facts"}
                      </span>
                    )}
                  </div>
                )}
                {openBadge === i * 2 && t.recalled && (
                  <div className="badge-detail">
                    {t.recalled.map((r, j) => (
                      <div key={j}>• {r.text}</div>
                    ))}
                  </div>
                )}
                {openBadge === i * 2 + 1 && t.learned && (
                  <div className="badge-detail">
                    {t.learned.map((l, j) => (
                      <div key={j}>• {l}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && <div className="thinking">Recalling memory, thinking, saving notes…</div>}
            {error && <div className="error">{error}</div>}
          </div>

          <div className="composer">
            <textarea
              placeholder="Ask a question or say what you want to study…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={sending}
            />
            <button onClick={sendMessage} disabled={sending || !draft.trim()}>
              Send
            </button>
          </div>
        </>
      )}
    </main>
  );
}

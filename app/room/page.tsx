"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadUser, type StudyBuddyUser } from "@/lib/id";

interface Msg {
  id: string;
  displayName: string;
  kind: "user" | "agent";
  addressedToName?: string | null;
  content: string;
  createdAt: string;
}

interface MyLastAsk {
  used: string[];
  learned: string[];
  fellBack: boolean;
}

const ROOM_KEY = "studybuddy.room.v1";
const ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newRoomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
  return `room-${s.slice(0, 4)}-${s.slice(4)}`;
}

export default function RoomPage() {
  const [user, setUser] = useState<StudyBuddyUser | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MyLastAsk | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastSeen = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUser(loadUser());
    const saved = window.localStorage.getItem(ROOM_KEY);
    if (saved) setRoomId(saved);
  }, []);

  const poll = useCallback(async () => {
    if (!roomId) return;
    try {
      const qs = new URLSearchParams({ roomId });
      if (lastSeen.current) qs.set("after", lastSeen.current);
      const res = await fetch(`/api/room/messages?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Poll failed (${res.status})`);
      const data: { messages: Msg[] } = await res.json();
      if (data.messages.length) {
        lastSeen.current = data.messages[data.messages.length - 1].createdAt;
        setMsgs((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...data.messages.filter((m) => !seen.has(m.id))];
        });
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection problem.");
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    lastSeen.current = null;
    setMsgs([]);
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [roomId, poll]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs]);

  function enterRoom(id: string) {
    const clean = id.trim().toLowerCase();
    if (!clean) return;
    window.localStorage.setItem(ROOM_KEY, clean);
    setRoomId(clean);
  }

  function leaveRoom() {
    window.localStorage.removeItem(ROOM_KEY);
    setRoomId(null);
    setMsgs([]);
    setMine(null);
  }

  async function send(askBuddy: boolean) {
    if (!user || !roomId || !draft.trim() || busy) return;
    const content = draft.trim();
    setDraft("");
    setBusy(true);
    setMine(null);
    try {
      const res = await fetch("/api/room/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, code: user.code, name: user.name, content, askBuddy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Send failed (${res.status})`);
      if (askBuddy) {
        setMine({
          used: data.usedPrivateNotes ?? [],
          learned: data.learnedPrivate ?? [],
          fellBack: Boolean(data.guard?.fellBack),
        });
      }
      await poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
      setDraft(content);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <div className="header">
        <nav className="nav">
          <a href="/">Private tutor</a>
          <a className="active" href="/room">Study room</a>
        </nav>
        <h1 className="serif">Study Room</h1>
        <p>
          Study with friends in one shared chat. Buddy remembers what everyone says in the room,
          and quietly uses what it knows about <em>you</em> from your private sessions to tailor
          its answers — without ever revealing those private notes to the room.
        </p>
      </div>

      {!user && (
        <div className="intake">
          <label>Set up your profile first so Buddy knows who you are.</label>
          <div className="intake-choice">
            <a href="/"><button>Go to profile setup</button></a>
          </div>
        </div>
      )}

      {user && !roomId && (
        <div className="intake">
          <label>Start a new room and share its code, or join a friend&apos;s.</label>
          <div className="intake-choice" style={{ marginBottom: 12 }}>
            <button onClick={() => enterRoom(newRoomId())}>Create a new room</button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); enterRoom(roomInput); }}>
            <input
              type="text"
              placeholder="Have a code? e.g. room-k7pq-x2mv"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
            />
            <button type="submit" className="cta">Join</button>
          </form>
        </div>
      )}

      {user && roomId && (
        <>
          <div className="namebar">
            <span>
              Room{" "}
              <code
                className="code-pill"
                title="Click to copy — share this with friends"
                onClick={() => navigator.clipboard?.writeText(roomId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
              >
                {roomId}
              </code>{" "}
              {copied && <span style={{ color: "var(--learned)" }}>copied!</span>} · you are {user.name}
            </span>
            <button onClick={leaveRoom}>Leave room</button>
          </div>

          <div className="log" ref={logRef} style={{ marginTop: 12 }}>
            {msgs.length === 0 && (
              <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>
                Nobody has spoken yet. <strong>Send</strong> talks to your friends;
                <strong> Ask Buddy</strong> also brings the tutor in.
              </p>
            )}
            {msgs.map((m) => {
              const isMe = m.kind === "user" && m.displayName === user.name;
              return (
                <div key={m.id} className={`turn ${isMe ? "user" : "bot"}`}>
                  <div className="sender">
                    {m.kind === "agent" ? `Study Buddy → ${m.addressedToName ?? "everyone"}` : m.displayName}
                  </div>
                  <div className={`bubble ${m.kind === "agent" ? "agent" : ""}`}>{m.content}</div>
                </div>
              );
            })}
            {busy && <div className="thinking">Buddy is thinking…</div>}
            {error && <div className="error">{error}</div>}
          </div>

          {mine && (
            <div className="mine">
              <span
                className="badge recall"
                style={{ cursor: "pointer" }}
                onClick={() => setShowMine((v) => !v)}
              >
                🔒 Buddy used {mine.used.length} private {mine.used.length === 1 ? "note" : "notes"} about you
              </span>{" "}
              <span className="hint">only you can see this line{mine.fellBack ? " · reply was withheld by the privacy guard" : ""}</span>
              {showMine && mine.used.length > 0 && (
                <div className="badge-detail" style={{ marginTop: 6 }}>
                  {mine.used.map((u, i) => <div key={i}>• {u}</div>)}
                </div>
              )}
            </div>
          )}

          <div className="composer">
            <textarea
              placeholder="Say something to the room…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(false); } }}
              disabled={busy}
            />
            <button className="secondary" onClick={() => send(false)} disabled={busy || !draft.trim()}>Send</button>
            <button onClick={() => send(true)} disabled={busy || !draft.trim()}>Ask Buddy</button>
          </div>
        </>
      )}
    </main>
  );
}

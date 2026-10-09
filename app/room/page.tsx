"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Gem, Lock, LogOut, Plus, Send, Sparkles } from "lucide-react";
import { useProfile } from "@/components/ProfileProvider";
import { Markdown } from "@/components/Markdown";
import { browserSupabase, roomTopic } from "@/lib/client/realtime";
import { ApiError, postJson, type Provider } from "@/lib/client/api";
import type { RoomHistoryLine } from "@/lib/roomHistory";

interface RoomMsg { id: string; speakerId?: string; displayName: string; kind: "user" | "agent"; addressedToName?: string | null; content: string; createdAt: string }
interface Mine { used: string[]; learned: string[]; fellBack: boolean; via: string | null }

const ROOM_KEY = "studybuddy.room.v2";
const PROVIDER_KEY = "studybuddy.room.provider";
const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "groq", label: "Groq (Qwen)" },
  { id: "gemini", label: "Gemini" },
];
const providerLabel = (p: Provider) => (p === "gemini" ? "Gemini" : "Groq");
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
function newRoomId() {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  const s = Array.from(b, (x) => ALPHA[x % ALPHA.length]).join("");
  return `room-${s.slice(0, 4)}-${s.slice(4)}`;
}
// Same derivation the server uses (sha256 of "speaker:"+code, first 12 hex) — lets us know which messages are ours.
async function speakerId(code: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`speaker:${code}`));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

export default function RoomPage() {
  const { profile } = useProfile();
  const sb = useMemo(() => browserSupabase(), []);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [msgs, setMsgs] = useState<RoomMsg[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [people, setPeople] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mine, setMine] = useState<Mine | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [copied, setCopied] = useState(false);
  // Same switch the Tutor has. It only changes which AI writes Buddy's replies —
  // the memory Buddy reads (and the privacy rules around it) are identical either way.
  const [provider, setProviderState] = useState<Provider>("groq");
  const [myId, setMyId] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const sid = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : "x");

  useEffect(() => { try { const r = localStorage.getItem(ROOM_KEY); if (r) setRoomId(r); } catch { /* ignore */ } }, []);
  useEffect(() => { if (profile) speakerId(profile.code).then(setMyId); }, [profile]);
  useEffect(() => { try { const v = localStorage.getItem(PROVIDER_KEY); if (v === "groq" || v === "gemini") setProviderState(v); } catch { /* ignore */ } }, []);
  const setProvider = (p: Provider) => { setProviderState(p); try { localStorage.setItem(PROVIDER_KEY, p); } catch { /* ignore */ } };

  // Live wire: Supabase Broadcast (messages) + Presence (who's here). Nothing
  // is stored there — but Walrus IS the durable record, so as soon as we
  // join we recall the room's actual transcript and seed the thread with it,
  // then broadcasts append to it live from that point on. That's what makes
  // "leave the room, come back" show real history instead of an empty chat.
  useEffect(() => {
    if (!sb || !roomId || !profile) return;
    setMsgs([]); setHistoryCount(0); setMine(null);
    const ch = sb.channel(roomTopic(roomId), { config: { broadcast: { self: true }, presence: { key: sid.current } } });
    ch.on("broadcast", { event: "msg" }, ({ payload }) => {
      const m = payload as RoomMsg;
      setMsgs((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]));
    });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState<{ name: string }>();
      setPeople([...new Set(Object.values(st).flat().map((p) => p.name))]);
    });
    ch.subscribe(async (status) => {
      setLive(status === "SUBSCRIBED");
      if (status === "SUBSCRIBED") await ch.track({ name: profile.name });
    });
    postJson<{ lines: RoomHistoryLine[] }>("/api/room/recap", { roomId })
      .then((r) => {
        const history: RoomMsg[] = r.lines.map((l) => ({
          id: l.blobId,
          displayName: l.displayName,
          kind: l.kind,
          addressedToName: l.addressedToName,
          content: l.content,
          createdAt: l.createdAt ?? new Date(0).toISOString(),
        }));
        setHistoryCount(history.length);
        setMsgs((prev) => [...history, ...prev.filter((p) => !history.some((h) => h.id === p.id))]);
      })
      .catch(() => {});
    return () => { sb.removeChannel(ch); setLive(false); };
  }, [sb, roomId, profile]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  const enter = (id: string) => {
    const c = id.trim().toLowerCase();
    if (!c) return;
    try { localStorage.setItem(ROOM_KEY, c); } catch { /* ignore */ }
    setRoomId(c);
  };
  const leave = () => { try { localStorage.removeItem(ROOM_KEY); } catch { /* ignore */ } setRoomId(null); setMsgs([]); setMine(null); };

  async function send(askBuddy: boolean) {
    if (!profile || !roomId || !draft.trim() || busy) return;
    const content = draft.trim();
    setDraft(""); setBusy(true); setErr(""); setMine(null);
    try {
      const r = await postJson<{ usedPrivateNotes: string[]; learnedPrivate: string[]; guard: { fellBack: boolean }; provider: Provider; model: string | null }>("/api/room/message", {
        roomId, code: profile.code, name: profile.name, content, askBuddy, provider,
        recentLines: msgs.slice(-8).map((m) => ({ displayName: m.displayName, kind: m.kind, content: m.content.slice(0, 300) })),
      });
      // Shown only to the sender (in the private panel) — never broadcast to the room.
      if (askBuddy) setMine({ used: r.usedPrivateNotes, learned: r.learnedPrivate, fellBack: r.guard.fellBack, via: r.model ? `${providerLabel(r.provider)} · ${r.model}` : null });
    } catch (e) {
      if (e instanceof ApiError && e.data.posted === true) {
        // Buddy couldn't answer, but the student's own message already reached the room:
        // don't hand the text back (re-sending would post it twice).
        setErr(`${e.message} Your message was posted to the room.`);
      } else {
        setErr(e instanceof Error ? e.message : "Couldn’t send."); setDraft(content);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Study Room</h1>
          <p>Study with friends in one live chat. Buddy remembers what everyone says here, and quietly uses what it knows about <em>you</em> — never revealing it to the room.</p>
        </div>
      </div>

      {!sb && (
        <div className="banner coral">Live rooms aren’t configured yet. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Vercel, then redeploy. <Link href="/status">Open Status</Link></div>
      )}

      {sb && !roomId && (
        <div className="card">
          <h2 className="display" style={{ margin: "0 0 6px", fontSize: 22 }}>Start or join a room</h2>
          <p className="tiny" style={{ margin: "0 0 16px" }}>Anyone with the room code can join, so share it only with people you want to study with.</p>
          <button className="btn primary lg" onClick={() => enter(newRoomId())}><Plus size={18} /> Create a new room</button>
          <form className="row gap" style={{ marginTop: 18 }} onSubmit={(e) => { e.preventDefault(); enter(joinInput); }}>
            <input className="input" placeholder="Have a code? e.g. room-k7pq-x2mv" value={joinInput} onChange={(e) => setJoinInput(e.target.value)} />
            <button className="btn ghost">Join</button>
          </form>
        </div>
      )}

      {sb && roomId && profile && (
        <>
          <div className="card roombar">
            <div className="row gap wrap">
              <span className={`live ${live ? "on" : ""}`}><i /> {live ? "Live" : "Connecting…"}</span>
              <div className="seg" role="group" aria-label="AI model for Buddy's replies">
                {PROVIDERS.map((pr) => (
                  <button key={pr.id} className={provider === pr.id ? "on" : ""} onClick={() => setProvider(pr.id)} title="Which AI writes Buddy's replies. You can switch anytime — Buddy's memory lives on Walrus, not inside either one.">{pr.label}</button>
                ))}
              </div>
              <button className="chip mint" title="Copy room code to share" onClick={async () => { try { await navigator.clipboard.writeText(roomId); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* blocked */ } }}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {roomId}
              </button>
            </div>
            <div className="row gap">
              <div className="people" title={people.join(", ")}>
                {people.slice(0, 5).map((n) => <div key={n} className="avatar">{n.slice(0, 1).toUpperCase()}</div>)}
              </div>
              <span className="tiny">{people.length || 1} here</span>
              <button className="icon-btn" aria-label="Leave room" onClick={leave}><LogOut size={16} /></button>
            </div>
          </div>

          <div className="rthread">
            {msgs.length === 0 && <div className="empty">Nobody has spoken yet. <strong>Send</strong> talks to your friends; <strong>Ask Buddy</strong> also brings the tutor in.</div>}
            {historyCount > 0 && <div className="tiny" style={{ textAlign: "center", margin: "2px 0 4px" }}>— earlier in this room, recalled from Walrus —</div>}
            {msgs.map((m, i) => {
              const me = m.kind === "user" && (m.speakerId ? m.speakerId === myId : m.displayName === profile.name);
              return (
                <div key={m.id}>
                  <div className={`rmsg ${me ? "me" : ""} ${m.kind === "agent" ? "agent" : ""}`}>
                    <span className="who">{m.kind === "agent" ? `Study Buddy → ${m.addressedToName ?? "everyone"}` : me ? "You" : m.displayName}</span>
                    <div className="rbubble">{m.kind === "agent" ? <Markdown>{m.content}</Markdown> : m.content}</div>
                  </div>
                  {historyCount > 0 && i === historyCount - 1 && <div className="tiny" style={{ textAlign: "center", margin: "6px 0" }}>— you’re caught up —</div>}
                </div>
              );
            })}
            {busy && <div className="tiny">Buddy is thinking…</div>}
            <div ref={endRef} />
          </div>

          {err && <div className="banner coral">{err}</div>}
          {mine && (
            <div className="private-note">
              <button className="chip amber" onClick={() => setShowMine((v) => !v)}><Lock size={12} /> used {mine.used.length} private note{mine.used.length === 1 ? "" : "s"} about you</button>
              {mine.learned.length > 0 && <span className="chip mint"><Gem size={12} /> learned {mine.learned.length} new {mine.learned.length === 1 ? "fact" : "facts"}</span>}
              {mine.via && <span className="chip"><Sparkles size={12} /> answered via {mine.via}</span>}
              <span className="tiny">only you can see this{mine.fellBack ? " · reply was replaced by the privacy guard" : ""}</span>
              {showMine && mine.used.length > 0 && <ul className="drawer" style={{ width: "100%" }}>{mine.used.map((u, i) => <li key={i}>{u}</li>)}</ul>}
            </div>
          )}

          <div className="composer-wrap">
            <div className="composer">
              <textarea
                rows={1} value={draft} placeholder="Say something to the room…"
                onChange={(e) => { setDraft(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(false); } }}
                disabled={busy}
              />
              <div className="two-btn">
                <button className="btn ghost" disabled={busy || !draft.trim()} onClick={() => send(false)}><Send size={15} /> Send</button>
                <button className="btn primary" disabled={busy || !draft.trim()} onClick={() => send(true)}><Sparkles size={15} /> Ask Buddy</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Level } from "@/lib/prompts";
import type { NoteView, SourceView, Provider } from "@/lib/client/api";
import type { Step } from "@/components/MemoryTrace";

// Lives ABOVE the routed page (see app/layout.tsx), so navigating to Quiz,
// Cards, Room, Memory or Status and back to the Tutor does not remount this
// provider — the conversation is still there. It is plain React state, not
// localStorage/sessionStorage, so a full page reload (or a new tab) starts a
// clean session on purpose: memory (the actual facts Buddy learned) already
// persists on Walrus and survives forever; this is just "is the chat window
// still open", which resets like any normal app tab would.

export interface TutorMsg {
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
  /** Which AI actually answered this specific message — kept per-message
   *  (not just in session state) so switching mid-conversation is visible
   *  turn-by-turn, not just as a current setting. */
  provider?: Provider;
  model?: string;
  topic?: { subject: string; topic: string } | null;
}
export interface TutorOpener {
  returning: boolean;
  greeting: string;
  suggestions: string[];
  notes: NoteView[];
  memoryOk: boolean;
}

interface Ctx {
  msgs: TutorMsg[];
  setMsgs: React.Dispatch<React.SetStateAction<TutorMsg[]>>;
  opener: TutorOpener | null;
  setOpener: (o: TutorOpener | null) => void;
  openerErr: boolean;
  setOpenerErr: (b: boolean) => void;
  openerFetched: boolean;
  markOpenerFetched: () => void;
  level: Level;
  setLevel: (l: Level) => void;
  provider: Provider;
  setProvider: (p: Provider) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  input: string;
  setInput: (s: string) => void;
  resetSession: () => void;
}
const C = createContext<Ctx | null>(null);

export function TutorSessionProvider({ children }: { children: React.ReactNode }) {
  const [msgs, setMsgs] = useState<TutorMsg[]>([]);
  const [opener, setOpener] = useState<TutorOpener | null>(null);
  const [openerErr, setOpenerErr] = useState(false);
  const [openerFetched, setOpenerFetched] = useState(false);
  const [level, setLevel] = useState<Level>("high");
  const [provider, setProvider] = useState<Provider>("groq");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");

  const resetSession = useCallback(() => {
    setMsgs([]);
    setOpener(null);
    setOpenerErr(false);
    setOpenerFetched(false);
    setInput("");
  }, []);
  const markOpenerFetched = useCallback(() => setOpenerFetched(true), []);

  const value = useMemo(
    () => ({ msgs, setMsgs, opener, setOpener, openerErr, setOpenerErr, openerFetched, markOpenerFetched, level, setLevel, provider, setProvider, busy, setBusy, input, setInput, resetSession }),
    [msgs, opener, openerErr, openerFetched, level, provider, busy, input, resetSession, markOpenerFetched]
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useTutorSession(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useTutorSession must be used inside TutorSessionProvider");
  return v;
}

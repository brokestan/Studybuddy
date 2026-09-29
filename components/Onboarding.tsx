"use client";
import { useState } from "react";
import { ArrowRight, Check, Copy, Download, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "./Logo";
import { useProfile } from "./ProfileProvider";
import { downloadKeyFile, generateKey, looksLikeKey, normalizeKey, type Profile } from "@/lib/client/profile";

type Step = "welcome" | "new" | "key" | "restore";

export function Onboarding() {
  const { setProfile } = useProfile();
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [draft, setDraft] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="brand-row">
          <Logo size={34} />
          <span className="brand-name">Study Buddy</span>
        </div>

        {step === "welcome" && (
          <>
            <h1 className="hero">A tutor that <em>actually remembers</em> you.</h1>
            <p className="lead">
              Study Buddy keeps your goals, weak spots and progress in encrypted memory on Walrus — so it picks up where you left off, on any device, and
              can even study with your friends without ever spilling your private notes.
            </p>
            <div className="stack">
              <button className="btn primary lg" onClick={() => setStep("new")}>
                <Sparkles size={18} /> I’m new here <ArrowRight size={18} />
              </button>
              <button className="btn ghost lg" onClick={() => setStep("restore")}>
                <KeyRound size={18} /> I have a memory key
              </button>
            </div>
            <p className="fine"><ShieldCheck size={14} /> No email, no password. Your memory key is your identity.</p>
          </>
        )}

        {step === "new" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setDraft({ code: generateKey(), name: name.trim().slice(0, 30) });
              setStep("key");
            }}
          >
            <h2 className="h2">What should I call you?</h2>
            <input className="input lg" autoFocus placeholder="Your first name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
            <div className="row gap">
              <button type="button" className="btn ghost" onClick={() => setStep("welcome")}>Back</button>
              <button className="btn primary" disabled={!name.trim()}>Continue <ArrowRight size={16} /></button>
            </div>
          </form>
        )}

        {step === "key" && draft && (
          <>
            <h2 className="h2">Save your memory key</h2>
            <p className="lead sm">
              This is how you get your memory back on your phone, another browser, or tomorrow. Treat it like a password — Study Buddy can’t recover it for you.
            </p>
            <div className="keybox">
              <code>{draft.code}</code>
              <button className="icon-btn" onClick={() => copy(draft.code)} aria-label="Copy key">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
            </div>
            <div className="row gap wrap">
              <button className="btn ghost" onClick={() => downloadKeyFile(draft)}><Download size={16} /> Download as file</button>
            </div>
            <label className="check">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I’ve saved my key somewhere safe
            </label>
            <button className="btn primary lg" disabled={!saved} onClick={() => setProfile(draft)}>Start studying <ArrowRight size={18} /></button>
          </>
        )}

        {step === "restore" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const k = normalizeKey(keyInput);
              if (!looksLikeKey(k)) return setErr("That doesn’t look like a memory key (e.g. k7pq-x2mv-9htn-w4cd).");
              if (!name.trim()) return setErr("Add the name you’d like me to use.");
              setProfile({ code: k, name: name.trim().slice(0, 30) });
            }}
          >
            <h2 className="h2">Welcome back</h2>
            <label className="lbl">Your memory key</label>
            <input className="input lg mono" autoFocus placeholder="xxxx-xxxx-xxxx-xxxx" value={keyInput} onChange={(e) => { setKeyInput(e.target.value); setErr(""); }} />
            <label className="lbl">Your name</label>
            <input className="input lg" placeholder="Your first name" value={name} maxLength={30} onChange={(e) => { setName(e.target.value); setErr(""); }} />
            {err && <p className="err">{err}</p>}
            <div className="row gap">
              <button type="button" className="btn ghost" onClick={() => setStep("welcome")}>Back</button>
              <button className="btn primary">Restore my memory <ArrowRight size={16} /></button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

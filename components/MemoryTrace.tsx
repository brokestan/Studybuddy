"use client";
import { useState } from "react";
import { Brain, Gem, Check } from "lucide-react";
import type { NoteView } from "@/lib/client/api";
import { shortBlob } from "@/lib/client/api";

export type Step = "recall" | "think" | "seal" | null;

/** The visible proof that memory is doing real work: what was recalled, what was sealed to Walrus. */
export function MemoryTrace({
  recalled,
  learned,
  step,
  memoryOk = true,
  sealError,
}: {
  recalled?: NoteView[];
  learned?: string[];
  step?: Step;
  memoryOk?: boolean;
  sealError?: string;
}) {
  const [open, setOpen] = useState<"r" | "l" | null>(null);
  const r = recalled ?? [];
  const l = learned ?? [];
  const steps: { id: Exclude<Step, null>; label: string }[] = [
    { id: "recall", label: "Recalling from Walrus" },
    { id: "think", label: "Thinking" },
    { id: "seal", label: "Sealing new memory" },
  ];
  const active = step ? steps.findIndex((s) => s.id === step) : -1;

  return (
    <div className="trace">
      {step && (
        <div className="pipeline" aria-live="polite">
          {steps.map((s, i) => (
            <span key={s.id} className={`pipe ${i < active ? "done" : i === active ? "on" : ""}`}>
              <i /> {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chips">
        {r.length > 0 && (
          <button className={`chip amber ${open === "r" ? "sel" : ""}`} onClick={() => setOpen(open === "r" ? null : "r")}>
            <Brain size={13} /> Recalled {r.length} {r.length === 1 ? "memory" : "memories"}
          </button>
        )}
        {l.length > 0 && (
          <button className={`chip mint ${open === "l" ? "sel" : ""}`} onClick={() => setOpen(open === "l" ? null : "l")}>
            <Gem size={13} /> Sealed {l.length} new {l.length === 1 ? "memory" : "memories"} on Walrus
          </button>
        )}
        {!memoryOk && <span className="chip coral">Walrus memory unreachable — answered without it</span>}
        {sealError && <span className="chip coral">Couldn’t save this to memory</span>}
        {!step && r.length === 0 && l.length === 0 && memoryOk && !sealError && (
          <span className="chip quiet"><Check size={12} /> nothing to recall yet</span>
        )}
      </div>
      {open === "r" && (
        <ul className="drawer">
          {r.map((n) => (
            <li key={n.blobId + n.text}>
              {n.text} <code title={n.blobId}>blob {shortBlob(n.blobId)}</code>
            </li>
          ))}
        </ul>
      )}
      {open === "l" && (
        <ul className="drawer">
          {l.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

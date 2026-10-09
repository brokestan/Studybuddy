// Browser-only fetch helpers.

/** An Error that also carries the server's JSON body, for callers that need more than the message. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown>) {
    super(message);
  }
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status, data as Record<string, unknown>);
  return data as T;
}

export interface NoteView {
  text: string;
  blobId: string;
  createdAt?: string;
}
export interface SourceView {
  title: string;
  url: string;
}
export type Provider = "groq" | "gemini";
export type TutorEvent =
  | { type: "status"; step: "recall" | "think" | "seal" }
  | { type: "meta"; memoryOk: boolean; recalled: NoteView[]; sources: SourceView[]; provider: Provider; model: string }
  | { type: "model"; provider: Provider; model: string } // which model REALLY answered (may differ from `meta` after a fallback)
  | { type: "token"; t: string }
  | { type: "done"; learned: string[]; sealError?: string; topic: { subject: string; topic: string } | null }
  | { type: "error"; message: string };

/** Reads the newline-delimited JSON stream from /api/tutor. */
export async function streamTutor(body: unknown, onEvent: (e: TutorEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/tutor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) onEvent(JSON.parse(l) as TutorEvent);
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as TutorEvent);
}

export const shortBlob = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
export function timeAgo(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

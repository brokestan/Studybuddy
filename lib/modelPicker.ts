// Groq retires models constantly (llama-3.3-70b-versatile: Aug 16 2026,
// qwen3.6-27b: Sep 14 2026). Instead of hard-coding "the current model" and
// being wrong within weeks, the app asks Groq what exists and picks the best
// eligible one. "Eligible" means: a chat model, and NOT made by OpenAI or
// Anthropic (the hackathon's "Beyond the Big Two" track).

const NOT_CHAT = /(whisper|guard|safeguard|tts|orpheus|compound|embed|moderation|prompt-guard|transcri)/i;
const OPENAI_MADE = /^openai\//i;

export function isEligibleChatModel(id: string): boolean {
  return !NOT_CHAT.test(id) && !OPENAI_MADE.test(id) && !/gpt-oss/i.test(id);
}

function qwenVersion(id: string): number | null {
  const m = id.match(/^qwen\/qwen(\d+)\.(\d+)/i);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

function rank(id: string): number {
  const q = qwenVersion(id);
  if (q !== null) return 10_000 + q; // newest Qwen first
  if (/^qwen\//i.test(id)) return 9_000;
  if (/^moonshotai\/kimi/i.test(id)) return 8_000;
  if (/^meta-llama\/llama-4/i.test(id)) return 7_000;
  if (/^llama-3\.3/i.test(id)) return 6_500;
  if (/llama/i.test(id)) return 6_000;
  if (/^minimaxai\//i.test(id)) return 5_000;
  return 1_000;
}

/** Returns the first preferred id that is available, else the best-ranked eligible one, else null. */
export function pickModel(available: string[], preferred: string[] = []): string | null {
  const ok = available.filter(isEligibleChatModel);
  for (const p of preferred) if (p && ok.includes(p)) return p;
  if (!ok.length) return null;
  return [...ok].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b))[0];
}

/** Qwen 3.6+ on Groq accepts reasoning_effort:"none" (plain fast dialogue). Others must not receive it. */
export function supportsReasoningNone(model: string): boolean {
  return /^qwen\/qwen3\.[6-9]/i.test(model);
}

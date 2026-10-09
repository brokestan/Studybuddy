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

/**
 * The FULL fallback order for Groq, best first: preferred ids that are
 * actually live (in the order the developer listed them), then every other
 * eligible model, best-ranked first. No duplicates, nothing ineligible.
 *
 * The caller walks this list when a model is overloaded or retired, so the
 * student gets an answer from the next-best model instead of an error.
 */
export function rankModels(available: string[], preferred: string[] = []): string[] {
  const ok = [...new Set(available.filter(isEligibleChatModel))];
  const head = [...new Set(preferred.filter((p) => p && ok.includes(p)))];
  const rest = ok.filter((m) => !head.includes(m)).sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  return [...head, ...rest];
}

/** The single best pick (kept for callers that only need one model). */
export function pickModel(available: string[], preferred: string[] = []): string | null {
  return rankModels(available, preferred)[0] ?? null;
}

/**
 * Parses an ordered preference list from an env var, e.g.
 *   GEMINI_MODEL="gemini-2.5-flash, gemini-2.0-flash"
 * Lets the developer choose and reorder candidates from the Vercel dashboard
 * with no code change. Blank entries and duplicates are dropped; order is kept.
 */
export function parsePreferenceList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
}

/** Qwen 3.6+ on Groq accepts reasoning_effort:"none" (plain fast dialogue). Others must not receive it. */
export function supportsReasoningNone(model: string): boolean {
  return /^qwen\/qwen3\.[6-9]/i.test(model);
}

// ---------- Gemini ----------
// Google's API returns model names as "models/gemini-2.5-flash"; both forms
// are normalized here since different endpoints return it differently.
const GEMINI_EXCLUDE = /(pro|image|tts|live|embedding|vision|thinking|-exp|vector)/i;

export function stripModelPrefix(id: string): string {
  return id.replace(/^models\//, "");
}

export function isEligibleGeminiModel(id: string): boolean {
  const bare = stripModelPrefix(id);
  return /^gemini-\d/i.test(bare) && !GEMINI_EXCLUDE.test(bare);
}

function geminiRank(id: string): number {
  const bare = stripModelPrefix(id);
  const m = bare.match(/^gemini-(\d+)(?:\.(\d+))?-flash(-lite)?/i);
  if (!m) return -1;
  const version = Number(m[1]) * 100 + Number(m[2] ?? 0);
  // A "-lite" model trades quality for cost/speed. For a tutoring app, prefer
  // full quality over a same-or-slightly-newer Lite variant — the penalty
  // (50) is deliberately bigger than a typical minor version bump (~1-10),
  // so only a genuinely newer generation of Flash outranks an older non-lite one.
  return version * 10 + (m[3] ? 0 : 50);
}

/** Full Gemini fallback order (bare ids): live preferred ids first, then newest plain Flash downwards. */
export function rankGeminiModels(available: string[], preferred: string[] = []): string[] {
  const ok = [...new Set(available.map(stripModelPrefix).filter(isEligibleGeminiModel))];
  const head = [...new Set(preferred.map((p) => (p ? stripModelPrefix(p) : "")).filter((p) => p && ok.includes(p)))];
  const rest = ok.filter((m) => !head.includes(m)).sort((a, b) => geminiRank(b) - geminiRank(a) || a.localeCompare(b));
  return [...head, ...rest];
}

/** Same shape as pickModel: preferred id wins if actually available, else the newest eligible Flash model. */
export function pickGeminiModel(available: string[], preferred: string[] = []): string | null {
  return rankGeminiModels(available, preferred)[0] ?? null;
}

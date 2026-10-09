import "server-only";
import { parsePreferenceList, rankGeminiModels, stripModelPrefix } from "./modelPicker";
import { filterHealthy, walkCandidates } from "./providerHealth";
import { fetchTimed } from "./fetchTimed";
import { parseSSEStream, ThinkFilter } from "./sse";
import type { Msg, Opts } from "./llm";
import { LlmError } from "./llm";

// Mirrors lib/llm.ts's two-layer approach for Gemini's own request/response
// shape (different enough from OpenAI-style that forcing them into one
// function isn't worth it). Used by the Tutor and the Study Room, so a student
// can prove Walrus memory survives switching the underlying AI.
//
// The bug this layer exists to fix: Gemini's free tier very often answers
//   503 {"error":{"code":503,"status":"UNAVAILABLE","message":"This model is
//   currently experiencing high demand..."}}
// especially on newer/preview models. That means "this model is busy", not
// "your request is wrong" — so we put that model on cooldown and try the next
// one in the ranked list, all inside the same request.
//
// Fallback happens ONLY within Gemini. If every Gemini model fails we say so
// (and suggest Groq) rather than silently answering with Groq, which would
// make the "which AI answered" display a lie.

const DEFAULT_GEMINI = "gemini-2.5-flash"; // last resort if /models is unreachable
const base = () => process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
/** GEMINI_MODEL may be a comma-separated, ordered preference list. */
const preferred = () => parsePreferenceList(process.env.GEMINI_MODEL).map(stripModelPrefix);
interface Cached { models: string[]; at: number; verified: boolean }
const g = globalThis as unknown as { __sbGeminiModels?: Cached };
const TTL = 10 * 60_000;
const DEADLINE_MS = 50_000;
// Gemini 2.5+/3 "thinking" tokens are counted against maxOutputTokens, so a
// small cap can come back truncated or empty even though the visible answer
// is short. This is headroom only (a ceiling, not a target) — the prompts
// still control how long answers actually are.
const THINKING_HEADROOM = 1000;

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new LlmError(500, "GEMINI_API_KEY is not set (Vercel → Settings → Environment Variables).");
  return k;
}
// The key travels in a header, never in the URL, so it can't end up in logs,
// error messages or proxies that record request URLs.
const authHeaders = () => ({ "x-goog-api-key": key() });

export async function listGeminiModels(): Promise<string[]> {
  const res = await fetch(`${base()}/models`, { headers: authHeaders(), signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new LlmError(res.status, `Gemini /models returned ${res.status}`);
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  return (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name);
}

/** The full ranked candidate list (best first). Unreachable /models → the configured ids + one hardcoded last resort. */
export async function resolveGeminiCandidates(force = false): Promise<Cached> {
  const c = g.__sbGeminiModels;
  if (!force && c && Date.now() - c.at < (c.verified ? TTL : 30_000)) return c;
  key();
  let list: string[] | null = null;
  try {
    list = await listGeminiModels();
  } catch (e) {
    if (e instanceof LlmError && (e.status === 400 || e.status === 401 || e.status === 403)) throw e; // bad key
  }
  if (list === null) {
    const models = [...new Set([...preferred(), DEFAULT_GEMINI])];
    return (g.__sbGeminiModels = { models, at: Date.now(), verified: false });
  }
  const models = rankGeminiModels(list, preferred());
  if (!models.length) throw new LlmError(503, "Gemini currently lists no eligible free Flash model for this app.");
  return (g.__sbGeminiModels = { models, at: Date.now(), verified: true });
}

/** Test isolation only. */
export function _resetGeminiCacheForTests(): void {
  g.__sbGeminiModels = undefined;
}

/** Back-compat: the model we'd try first right now. */
export async function resolveGeminiModel(force = false): Promise<{ model: string; verified: boolean; at: number }> {
  const c = await resolveGeminiCandidates(force);
  return { model: filterHealthy(c.models, "gemini")[0], verified: c.verified, at: c.at };
}

interface GeminiMsg { role: "user" | "model"; parts: { text: string }[] }

function toGeminiRequest(messages: Msg[]): { contents: GeminiMsg[]; systemInstruction?: { parts: { text: string }[] } } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents: GeminiMsg[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  return system ? { contents, systemInstruction: { parts: [{ text: system }] } } : { contents };
}

function post(model: string, messages: Msg[], o: Opts, stream: boolean): Promise<Response> {
  const body = {
    ...toGeminiRequest(messages),
    generationConfig: { temperature: o.temperature ?? 0.7, maxOutputTokens: (o.maxTokens ?? 900) + THINKING_HEADROOM },
  };
  const method = stream ? "streamGenerateContent" : "generateContent";
  const sse = stream ? "?alt=sse" : "";
  return fetchTimed(`${base()}/models/${model}:${method}${sse}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
}

function classify(status: number, text: string): LlmError {
  const retired = status === 404 || (status === 400 && /not found|not supported|unsupported model/i.test(text) && !/api key/i.test(text));
  const worthy = retired || status === 408 || status === 429 || status >= 500; // INCLUDES 503 UNAVAILABLE ("high demand")
  const msg = status === 429 ? "Gemini's free quota is busy right now — try again in a few seconds." : `Gemini ${status}: ${text.slice(0, 200)}`;
  return new LlmError(status, msg, worthy);
}

/** One try on one model. (Gemini has no optional parameters we retry without, so unlike Groq there is no inner loop.) */
async function attemptModel(model: string, messages: Msg[], o: Opts, stream: boolean): Promise<Response> {
  let res: Response;
  try {
    res = await post(model, messages, o, stream);
  } catch (e) {
    throw new LlmError(503, `Gemini network error on ${model}: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  if (res.ok) return res;
  throw classify(res.status, await res.text().catch(() => ""));
}

function exhausted(last: unknown, tried: string[]): LlmError {
  console.error(`[gemini] every candidate failed (${tried.join(", ")}):`, last instanceof Error ? last.message : last);
  const n = `${tried.length} Gemini model${tried.length === 1 ? "" : "s"}`;
  const quota = last instanceof LlmError && last.status === 429;
  return new LlmError(
    quota ? 429 : 503,
    `Gemini is ${quota ? "out of free quota" : "overloaded"} right now (tried ${n}). Switch the AI to Groq and Buddy will still remember everything, or try Gemini again in a minute.`
  );
}

async function walk<T>(messages: Msg[], o: Opts, stream: boolean, handle: (res: Response, model: string) => Promise<T>): Promise<{ value: T; model: string }> {
  const { models } = await resolveGeminiCandidates();
  const { value, model } = await walkCandidates({
    provider: "gemini",
    candidates: models,
    deadlineAt: Date.now() + DEADLINE_MS,
    attempt: async (m) => handle(await attemptModel(m, messages, o, stream), m),
    shouldFallback: (e) => e instanceof LlmError && e.fallbackWorthy,
    onExhausted: exhausted,
  });
  return { value, model };
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** Like chatGemini(), but also says which model actually answered. */
export async function chatGeminiWithModel(messages: Msg[], o: Opts = {}): Promise<{ text: string; model: string }> {
  const { value, model } = await walk(messages, o, false, async (res) => {
    let data: { candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string } };
    try {
      data = await res.json();
    } catch (e) {
      throw new LlmError(502, `Gemini response could not be read: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    if (data?.promptFeedback?.blockReason) {
      // Every model would refuse the same prompt, so walking the list can't help.
      throw new LlmError(422, "Gemini declined to answer that one (its safety filter). Try rephrasing, or switch to Groq.");
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new LlmError(502, "Gemini returned an unexpected response shape.", true);
    const text = stripThink(parts.map((p) => p.text ?? "").join(""));
    if (!text) throw new LlmError(502, "Gemini returned an empty answer.", true);
    return text;
  });
  return { text: value, model };
}

export async function chatGemini(messages: Msg[], o: Opts = {}): Promise<string> {
  return (await chatGeminiWithModel(messages, o)).text;
}

async function* tokens(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const filter = new ThinkFilter();
  for await (const line of parseSSEStream(body)) {
    if (!line) continue;
    try {
      const parts = JSON.parse(line)?.candidates?.[0]?.content?.parts ?? [];
      const tok = parts.map((p: { text?: string }) => p.text ?? "").join("");
      const clean = tok ? filter.push(tok) : "";
      if (clean) yield clean;
    } catch {
      /* skip malformed chunk */
    }
  }
  const rest = filter.flush();
  if (rest) yield rest;
}

/** See llm.ts openStream: fallback can only happen before the first token. */
export async function openGeminiStream(messages: Msg[], o: Opts = {}): Promise<{ model: string; stream: AsyncGenerator<string> }> {
  const { value, model } = await walk(messages, o, true, async (res) => {
    if (!res.body) throw new LlmError(502, "Gemini returned no stream.", true);
    return res.body;
  });
  return { model, stream: tokens(value) };
}

export async function* chatGeminiStream(messages: Msg[], o: Opts = {}): AsyncGenerator<string> {
  const { stream } = await openGeminiStream(messages, o);
  yield* stream;
}

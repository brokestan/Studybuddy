import "server-only";
import { parsePreferenceList, rankModels, supportsReasoningNone } from "./modelPicker";
import { filterHealthy, walkCandidates } from "./providerHealth";
import { fetchTimed } from "./fetchTimed";
import { parseSSEStream, ThinkFilter } from "./sse";

// Groq client. Protections learned the hard way:
//  1. It asks Groq which models exist and builds a RANKED list of eligible
//     ones (models are retired every few weeks).
//  2. Two layers of retrying, kept deliberately separate:
//       - INNER, per model: drop an optional parameter (reasoning_effort /
//         JSON mode) that one specific model rejects. That is "this model
//         doesn't like this parameter", not an availability problem, so it
//         never moves on to another model.
//       - OUTER, across models: if a model is retired (404), rate limited
//         (429) or overloaded (5xx), put it on cooldown and try the next
//         candidate — inside the same request, so the student never sees it.
//  3. A genuine failure (e.g. a real 400) is NOT retried across models.

export interface Msg {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface Opts {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export class LlmError extends Error {
  /**
   * true  = "this MODEL is unavailable right now" (retired / rate limited /
   *         overloaded) — trying the next candidate may well work.
   * false = "this REQUEST cannot succeed" (bad request, bad key, nothing left
   *         to try) — walking the list would only waste time.
   */
  constructor(public status: number, message: string, public fallbackWorthy = false) {
    super(message);
  }
}

const DEFAULT_MODEL = "qwen/qwen3.8-27b"; // last resort if /models is unreachable
const base = () => process.env.GROQ_API_BASE ?? "https://api.groq.com/openai/v1";
/** GROQ_MODEL may be a comma-separated, ordered preference list. */
const preferred = () => {
  const list = parsePreferenceList(process.env.GROQ_MODEL);
  return list.includes(DEFAULT_MODEL) ? list : [...list, DEFAULT_MODEL];
};
interface Cached { models: string[]; at: number; verified: boolean }
const g = globalThis as unknown as { __sbGroqModels?: Cached };
const TTL = 10 * 60_000;
const DEADLINE_MS = 50_000; // stop starting new attempts near Vercel's 60s limit

function key(): string {
  const k = process.env.GROQ_API_KEY;
  if (!k) throw new LlmError(500, "GROQ_API_KEY is not set (Vercel → Settings → Environment Variables).");
  return k;
}

export async function listModels(): Promise<string[]> {
  const res = await fetch(`${base()}/models`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new LlmError(res.status, `Groq /models returned ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

/** The full ranked candidate list (best first). Unreachable /models → the configured ids + one hardcoded last resort. */
export async function resolveCandidates(force = false): Promise<Cached> {
  const c = g.__sbGroqModels;
  if (!force && c && Date.now() - c.at < (c.verified ? TTL : 30_000)) return c;
  key(); // a missing key is a configuration error, not a network blip: fail loudly
  let list: string[] | null = null;
  try {
    list = await listModels();
  } catch (e) {
    if (e instanceof LlmError && (e.status === 401 || e.status === 403)) throw e; // bad key
    // Timeout / network error / 5xx / 429 on /models: don't crash — keep answering on what we know.
  }
  if (list === null) return (g.__sbGroqModels = { models: preferred(), at: Date.now(), verified: false });
  const models = rankModels(list, preferred());
  if (!models.length) throw new LlmError(503, "Groq currently lists no eligible chat model for this app.");
  return (g.__sbGroqModels = { models, at: Date.now(), verified: true });
}

/** Test isolation only. */
export function _resetModelCacheForTests(): void {
  g.__sbGroqModels = undefined;
}

/** Back-compat: the model we'd try first right now. */
export async function resolveModel(force = false): Promise<{ model: string; verified: boolean; at: number }> {
  const c = await resolveCandidates(force);
  return { model: filterHealthy(c.models, "groq")[0], verified: c.verified, at: c.at };
}

async function post(model: string, messages: Msg[], o: Opts, stream: boolean, drop: { reasoning: boolean; json: boolean }) {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: o.temperature ?? 0.7,
    top_p: 0.8,
    max_tokens: o.maxTokens ?? 700,
    stream,
  };
  if (supportsReasoningNone(model) && !drop.reasoning) body.reasoning_effort = "none";
  if (o.json && !drop.json) body.response_format = { type: "json_object" };
  return fetchTimed(`${base()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify(body),
  });
}

const RETIRED_RE = /decommission|model_not_found|does not exist/i;

function classify(status: number, text: string): LlmError {
  const retired = status === 404 || RETIRED_RE.test(text);
  const worthy = retired || status === 408 || status === 429 || status >= 500;
  const msg = status === 429 ? "The free AI quota is busy right now — try again in a few seconds." : `Groq ${status}: ${text.slice(0, 200)}`;
  return new LlmError(status, msg, worthy);
}

/** INNER layer: everything that can be fixed by changing a parameter, on ONE model. */
async function attemptModel(model: string, messages: Msg[], o: Opts, stream: boolean): Promise<Response> {
  const drop = { reasoning: false, json: false };
  for (let i = 0; i < 3; i++) {
    let res: Response;
    try {
      res = await post(model, messages, o, stream, drop);
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(503, `Groq network error on ${model}: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    if (!RETIRED_RE.test(text)) {
      if (res.status === 400 && /reasoning/i.test(text) && !drop.reasoning) { drop.reasoning = true; continue; }
      if (res.status === 400 && o.json && /response_format|json/i.test(text) && !drop.json) { drop.json = true; continue; }
    }
    throw classify(res.status, text);
  }
  throw new LlmError(502, `Groq did not accept the request on ${model} after parameter retries.`);
}

function exhausted(last: unknown, tried: string[]): LlmError {
  console.error(`[groq] every candidate failed (${tried.join(", ")}):`, last instanceof Error ? last.message : last);
  if (last instanceof LlmError && last.status === 429) return new LlmError(429, "The free AI quota is busy right now — try again in a few seconds.");
  return new LlmError(503, `Groq is unavailable right now (tried ${tried.length} model${tried.length === 1 ? "" : "s"}). Please try again in a moment.`);
}

/** OUTER layer: walk the ranked candidates; `handle` turns an OK response into the final value (and may itself reject a model). */
async function walk<T>(messages: Msg[], o: Opts, stream: boolean, handle: (res: Response, model: string) => Promise<T>): Promise<{ value: T; model: string }> {
  const { models } = await resolveCandidates();
  const { value, model } = await walkCandidates({
    provider: "groq",
    candidates: models,
    deadlineAt: Date.now() + DEADLINE_MS,
    attempt: async (m) => handle(await attemptModel(m, messages, o, stream), m),
    shouldFallback: (e) => e instanceof LlmError && e.fallbackWorthy,
    onExhausted: exhausted,
  });
  return { value, model };
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** Like chat(), but also says which model actually answered. */
export async function chatWithModel(messages: Msg[], o: Opts = {}): Promise<{ text: string; model: string }> {
  const { value, model } = await walk(messages, o, false, async (res) => {
    let data: { choices?: { message?: { content?: unknown } }[] };
    try {
      data = await res.json();
    } catch (e) {
      throw new LlmError(502, `Groq response could not be read: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new LlmError(502, "Groq returned an unexpected response shape.", true);
    const text = stripThink(raw);
    if (!text) throw new LlmError(502, "Groq returned an empty answer.", true); // e.g. reasoning-only output
    return text;
  });
  return { text: value, model };
}

export async function chat(messages: Msg[], o: Opts = {}): Promise<string> {
  return (await chatWithModel(messages, o)).text;
}

async function* tokens(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const filter = new ThinkFilter();
  for await (const line of parseSSEStream(body)) {
    if (!line || line === "[DONE]") continue;
    try {
      const tok: string = JSON.parse(line)?.choices?.[0]?.delta?.content ?? "";
      const clean = tok ? filter.push(tok) : "";
      if (clean) yield clean;
    } catch {
      /* skip malformed chunk */
    }
  }
  const rest = filter.flush();
  if (rest) yield rest;
}

/**
 * Connects (walking fallbacks if needed) and returns the model that actually
 * answered together with its token stream. Fallback can only happen BEFORE
 * the first token — once text is flowing to the student there is no clean way
 * to switch models mid-sentence.
 */
export async function openStream(messages: Msg[], o: Opts = {}): Promise<{ model: string; stream: AsyncGenerator<string> }> {
  const { value, model } = await walk(messages, o, true, async (res) => {
    if (!res.body) throw new LlmError(502, "Groq returned no stream.", true);
    return res.body;
  });
  return { model, stream: tokens(value) };
}

export async function* chatStream(messages: Msg[], o: Opts = {}): AsyncGenerator<string> {
  const { stream } = await openStream(messages, o);
  yield* stream;
}

/** Ask for JSON, validate it, and retry once with a stern reminder if invalid. */
export async function chatJson<T>(messages: Msg[], parse: (text: string) => T, o: Opts = {}): Promise<T> {
  const first = await chat(messages, { ...o, json: true, temperature: o.temperature ?? 0.4 });
  try {
    return parse(first);
  } catch {
    const second = await chat(
      [...messages, { role: "assistant", content: first.slice(0, 1500) }, { role: "user", content: "That was not valid. Reply again with ONLY the JSON object, exactly matching the requested schema." }],
      { ...o, json: true, temperature: 0.2 }
    );
    return parse(second);
  }
}

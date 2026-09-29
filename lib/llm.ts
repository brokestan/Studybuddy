import "server-only";
import { pickModel, supportsReasoningNone } from "./modelPicker";
import { parseSSEStream, ThinkFilter } from "./sse";

// Groq client with three protections learned the hard way:
//  1. It asks Groq which models exist and picks a working, eligible one
//     (models are retired every few weeks).
//  2. If a call says "model not found", it re-resolves once and retries.
//  3. It drops optional parameters (reasoning_effort / JSON mode) if a model rejects them.

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
  constructor(public status: number, message: string) {
    super(message);
  }
}

const base = () => process.env.GROQ_API_BASE ?? "https://api.groq.com/openai/v1";
const preferred = () => [process.env.GROQ_MODEL ?? "", "qwen/qwen3.8-27b"].filter(Boolean);
const g = globalThis as unknown as { __sbModel?: { model: string; at: number; verified: boolean } };
const TTL = 10 * 60_000;

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

export async function resolveModel(force = false): Promise<{ model: string; verified: boolean; at: number }> {
  const c = g.__sbModel;
  if (!force && c && Date.now() - c.at < (c.verified ? TTL : 30_000)) return c;
  try {
    const list = await listModels();
    const model = pickModel(list, preferred());
    if (!model) throw new LlmError(503, "Groq currently lists no eligible chat model for this app.");
    return (g.__sbModel = { model, at: Date.now(), verified: true });
  } catch (e) {
    if (e instanceof LlmError && e.status !== 503 && e.status < 500 && e.status !== 0) throw e; // bad key etc.
    if (e instanceof LlmError && e.status === 503) throw e;
    // Network hiccup on /models: fall back to the configured id, unverified, retry soon.
    return (g.__sbModel = { model: preferred()[0], at: Date.now(), verified: false });
  }
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
  return fetch(`${base()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });
}

async function send(messages: Msg[], o: Opts, stream: boolean): Promise<{ res: Response; model: string }> {
  const drop = { reasoning: false, json: false };
  let forced = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { model } = await resolveModel(forced);
    const res = await post(model, messages, o, stream, drop);
    if (res.ok) return { res, model };
    const text = await res.text().catch(() => "");
    if ((res.status === 404 || /decommission|model_not_found|does not exist/i.test(text)) && !forced) { forced = true; continue; }
    if (res.status === 400 && /reasoning/i.test(text) && !drop.reasoning) { drop.reasoning = true; continue; }
    if (res.status === 400 && o.json && /response_format|json/i.test(text) && !drop.json) { drop.json = true; continue; }
    if (res.status === 429) throw new LlmError(429, "The free AI quota is busy right now — try again in a few seconds.");
    throw new LlmError(res.status, `Groq ${res.status}: ${text.slice(0, 200)}`);
  }
  throw new LlmError(502, "Groq did not accept the request after retries.");
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export async function chat(messages: Msg[], o: Opts = {}): Promise<string> {
  const { res } = await send(messages, o, false);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new LlmError(502, "Groq returned an unexpected response shape.");
  return stripThink(text);
}

export async function* chatStream(messages: Msg[], o: Opts = {}): AsyncGenerator<string> {
  const { res } = await send(messages, o, true);
  if (!res.body) throw new LlmError(502, "Groq returned no stream.");
  const filter = new ThinkFilter();
  for await (const line of parseSSEStream(res.body)) {
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

import "server-only";
import { pickGeminiModel } from "./modelPicker";
import { parseSSEStream, ThinkFilter } from "./sse";
import type { Msg, Opts } from "./llm";
import { LlmError } from "./llm";

// Mirrors lib/llm.ts's self-healing approach (ask the API what's live, cache
// briefly, retry once on a dead model) but for Gemini's own request/response
// shape, which is different enough from OpenAI-style that it isn't worth
// forcing into the same function. Used only by the Tutor chat, so a student
// can prove Walrus memory survives switching the underlying AI mid-conversation.

const base = () => process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
const preferred = () => [process.env.GEMINI_MODEL ?? ""].filter(Boolean);
const g = globalThis as unknown as { __sbGeminiModel?: { model: string; at: number; verified: boolean } };
const TTL = 10 * 60_000;

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new LlmError(500, "GEMINI_API_KEY is not set (Vercel → Settings → Environment Variables).");
  return k;
}

export async function listGeminiModels(): Promise<string[]> {
  const res = await fetch(`${base()}/models?key=${key()}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new LlmError(res.status, `Gemini /models returned ${res.status}`);
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  return (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name);
}

export async function resolveGeminiModel(force = false): Promise<{ model: string; verified: boolean; at: number }> {
  const c = g.__sbGeminiModel;
  if (!force && c && Date.now() - c.at < (c.verified ? TTL : 30_000)) return c;
  try {
    const list = await listGeminiModels();
    const model = pickGeminiModel(list, preferred());
    if (!model) throw new LlmError(503, "Gemini currently lists no eligible free Flash model for this app.");
    return (g.__sbGeminiModel = { model, at: Date.now(), verified: true });
  } catch (e) {
    if (e instanceof LlmError && (e.status === 503 || (e.status < 500 && e.status !== 0))) throw e;
    return (g.__sbGeminiModel = { model: preferred()[0] || "gemini-2.5-flash", at: Date.now(), verified: false });
  }
}

interface GeminiMsg { role: "user" | "model"; parts: { text: string }[] }

function toGeminiRequest(messages: Msg[]): { contents: GeminiMsg[]; systemInstruction?: { parts: { text: string }[] } } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents: GeminiMsg[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  return system ? { contents, systemInstruction: { parts: [{ text: system }] } } : { contents };
}

async function post(model: string, messages: Msg[], o: Opts, stream: boolean): Promise<Response> {
  const body = { ...toGeminiRequest(messages), generationConfig: { temperature: o.temperature ?? 0.7, maxOutputTokens: o.maxTokens ?? 900 } };
  const method = stream ? "streamGenerateContent" : "generateContent";
  const sse = stream ? "&alt=sse" : "";
  return fetch(`${base()}/models/${model}:${method}?key=${key()}${sse}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });
}

async function send(messages: Msg[], o: Opts, stream: boolean): Promise<{ res: Response; model: string }> {
  let forced = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { model } = await resolveGeminiModel(forced);
    const res = await post(model, messages, o, stream);
    if (res.ok) return { res, model };
    const text = await res.text().catch(() => "");
    if ((res.status === 404 || /not found|unsupported model/i.test(text)) && !forced) {
      forced = true;
      continue;
    }
    if (res.status === 429) throw new LlmError(429, "Gemini's free quota is busy right now — try again in a few seconds.");
    throw new LlmError(res.status, `Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  throw new LlmError(502, "Gemini did not accept the request after retries.");
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export async function chatGemini(messages: Msg[], o: Opts = {}): Promise<string> {
  const { res } = await send(messages, o, false);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (typeof text !== "string") throw new LlmError(502, "Gemini returned an unexpected response shape.");
  return stripThink(text);
}

export async function* chatGeminiStream(messages: Msg[], o: Opts = {}): AsyncGenerator<string> {
  const { res } = await send(messages, o, true);
  if (!res.body) throw new LlmError(502, "Gemini returned no stream.");
  const filter = new ThinkFilter();
  for await (const line of parseSSEStream(res.body)) {
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

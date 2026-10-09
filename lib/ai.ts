import "server-only";
import { chatStream, chatWithModel, openStream, resolveCandidates, type Msg, type Opts } from "./llm";
import { chatGeminiStream, chatGeminiWithModel, openGeminiStream, resolveGeminiCandidates } from "./gemini";
import { cooldownStatus, filterHealthy } from "./providerHealth";

// The one place that knows "there are two possible AI backends". Everything
// else (the tutor route, the prompt, the memory recall/seal) is identical
// regardless of which one answers — that's the point: Walrus memory doesn't
// belong to either provider, so switching this has zero effect on what
// Buddy remembers.
//
// Fallback is per provider and never crosses over: if every Gemini model is
// down the student gets an error that says so, NOT a silent Groq answer.
export type Provider = "groq" | "gemini";

export const providerName = (p: Provider) => (p === "gemini" ? "Gemini" : "Groq");
export const modelLabel = (p: Provider, model: string) => `${providerName(p)} · ${model}`;

export function streamAnswer(provider: Provider, messages: Msg[], o: Opts = {}): AsyncGenerator<string> {
  return provider === "gemini" ? chatGeminiStream(messages, o) : chatStream(messages, o);
}

/** Streaming that also reports which model really answered (after any fallback), before the first token. */
export async function openAnswerStream(provider: Provider, messages: Msg[], o: Opts = {}): Promise<{ model: string; stream: AsyncGenerator<string> }> {
  return provider === "gemini" ? openGeminiStream(messages, o) : openStream(messages, o);
}

/** Non-streaming (Study Room replies are broadcast as one message): the text plus the model that produced it. */
export async function answerOnce(provider: Provider, messages: Msg[], o: Opts = {}): Promise<{ text: string; model: string }> {
  return provider === "gemini" ? chatGeminiWithModel(messages, o) : chatWithModel(messages, o);
}

export interface CandidateView {
  provider: Provider;
  /** Full ranked order, best first, ignoring cooldowns. */
  ranked: string[];
  /** The order requests will actually try right now (cooling-down models removed unless that would leave nothing). */
  tryOrder: string[];
  /** Models currently cooling down, with seconds remaining. */
  cooling: { model: string; secondsLeft: number }[];
  /** false = /models was unreachable and this is only the configured/last-resort list. */
  verified: boolean;
}

/** For the Status page: the complete fallback picture for one provider. */
export async function candidatesFor(provider: Provider, force = false): Promise<CandidateView> {
  const { models, verified } = provider === "gemini" ? await resolveGeminiCandidates(force) : await resolveCandidates(force);
  return { provider, ranked: models, tryOrder: filterHealthy(models, provider), cooling: cooldownStatus(models, provider), verified };
}

/** A short label for the UI: which provider, and which model we'd try first right now. */
export async function currentModelLabel(provider: Provider): Promise<string> {
  try {
    const { tryOrder } = await candidatesFor(provider);
    return modelLabel(provider, tryOrder[0]);
  } catch {
    return providerName(provider);
  }
}

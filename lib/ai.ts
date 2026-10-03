import "server-only";
import { chatStream, resolveModel, type Msg, type Opts } from "./llm";
import { chatGeminiStream, resolveGeminiModel } from "./gemini";

// The one place that knows "there are two possible AI backends". Everything
// else (the tutor route, the prompt, the memory recall/seal) is identical
// regardless of which one answers — that's the point: Walrus memory doesn't
// belong to either provider, so switching this has zero effect on what
// Buddy remembers.
export type Provider = "groq" | "gemini";

export function streamAnswer(provider: Provider, messages: Msg[], o: Opts = {}): AsyncGenerator<string> {
  return provider === "gemini" ? chatGeminiStream(messages, o) : chatStream(messages, o);
}

/** A short label for the UI: which provider, and which model resolved right now. */
export async function currentModelLabel(provider: Provider): Promise<string> {
  try {
    if (provider === "gemini") {
      const { model } = await resolveGeminiModel();
      return `Gemini · ${model}`;
    }
    const { model } = await resolveModel();
    return `Groq · ${model}`;
  } catch {
    return provider === "gemini" ? "Gemini" : "Groq";
  }
}

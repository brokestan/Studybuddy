import "server-only";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Groq retires models often (llama-3.3-70b-versatile died on 2026-08-16,
// qwen/qwen3.6-27b on 2026-09-14). Keep the id in an env var so a future
// retirement is a 10-second fix in Vercel, not a code change.
// Check https://console.groq.com/docs/deprecations for the current list.
//
// Qwen is an open-weight model from Alibaba and Groq is a listed provider, so
// this build qualifies for the hackathon's "Beyond the Big Two" track.
// (openai/gpt-oss-* is deliberately avoided: it is OpenAI-made.)
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";

export async function askGroq(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GROQ_API_KEY. Get a free key at https://console.groq.com/keys and put it in .env.local (locally) or your Vercel project's Environment Variables (in production)."
    );
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.7,
      top_p: 0.8,
      max_tokens: 700,
      // Qwen 3.8 supports "none" = no thinking tokens, fast plain dialogue.
      reasoning_effort: "none",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint =
      res.status === 404 || /decommission|not exist|model_not_found/i.test(text)
        ? ` (model "${GROQ_MODEL}" may have been retired — set GROQ_MODEL to a current one, see console.groq.com/docs/deprecations)`
        : "";
    throw new Error(`Groq API error ${res.status}${hint}: ${text}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string") {
    throw new Error("Groq API returned an unexpected response shape.");
  }
  // Belt and braces: strip any <think> block if a model ever emits one.
  return reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

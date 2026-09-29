import { chatStream, type Msg } from "@/lib/llm";
import { recallSafe, learn } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { tutorSystemPrompt } from "@/lib/prompts";
import { shouldGround, groundOn } from "@/lib/wiki";
import { ndjson } from "@/lib/sse";
import { TutorBody } from "@/lib/schemas";
import { limited, parse, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Streams newline-delimited JSON events to the browser:
//   status(recall|think|seal) → meta(recalled notes, sources) → token* → done(learned facts) | error
export async function POST(req: Request) {
  const lim = limited(req, "tutor", 20);
  if (lim) return lim;
  const p = await parse(req, TutorBody);
  if (!p.ok) return p.res;
  const { code, name, message, history, level } = p.data;
  const ns = privateNamespace(code); // derived server-side; the browser never names a namespace

  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (o: unknown) => c.enqueue(ndjson(o));
      try {
        send({ type: "status", step: "recall" });
        const [mem, sources] = await Promise.all([
          recallSafe(ns, message, { limit: 6, maxDistance: 0.8 }),
          shouldGround(message) ? groundOn(message) : Promise.resolve([]),
        ]);
        send({
          type: "meta",
          memoryOk: mem.ok,
          recalled: mem.notes.map((n) => ({ text: n.text, blobId: n.blobId, createdAt: n.createdAt })),
          sources: sources.map((s) => ({ title: s.title, url: s.url })),
        });

        send({ type: "status", step: "think" });
        const messages: Msg[] = [
          { role: "system", content: tutorSystemPrompt({ name, level, notes: mem.notes.map((n) => n.text), sources, memoryOk: mem.ok }) },
          ...history.slice(-12),
          { role: "user", content: message },
        ];
        let full = "";
        for await (const t of chatStream(messages, { maxTokens: 900 })) {
          full += t;
          send({ type: "token", t });
        }

        send({ type: "status", step: "seal" });
        let learned: string[] = [];
        let sealError: string | undefined;
        if (message.length >= 12) {
          try {
            learned = (await learn(ns, `${name} (student) said: "${message}"\nTutor covered: ${full.slice(0, 300)}`)).facts;
          } catch (e) {
            sealError = errMsg(e);
            console.error("[tutor] learn failed:", sealError);
          }
        }
        send({ type: "done", learned, sealError });
      } catch (e) {
        send({ type: "error", message: errMsg(e) });
      } finally {
        c.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}

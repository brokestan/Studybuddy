import { chatJson, type Msg } from "@/lib/llm";
import { openAnswerStream, currentModelLabel, modelLabel, type Provider } from "@/lib/ai";
import { recallSafe, learn, remember, recallTimeoutMs, recallTimedOut } from "@/lib/memory";
import { privateNamespace } from "@/lib/identity";
import { tutorSystemPrompt, topicTagPrompt } from "@/lib/prompts";
import { formatTopicMemory, groupBySubject, parseTopicMemory, summarizeSubjects } from "@/lib/topics";
import { extractJson } from "@/lib/quizJson";
import { shouldGround, groundOn } from "@/lib/wiki";
import { ndjson } from "@/lib/sse";
import { TutorBody } from "@/lib/schemas";
import { limited, parse, errMsg, withTimeout } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TopicTag = z.object({ subject: z.string().min(2).max(40).nullable(), topic: z.string().min(2).max(80).nullable() });

// Streams newline-delimited JSON events to the browser:
//   status(recall|think|seal) → meta(recalled notes, sources, model) → token* → done(learned facts, topic) | error
export async function POST(req: Request) {
  const lim = limited(req, "tutor", 20);
  if (lim) return lim;
  const p = await parse(req, TutorBody);
  if (!p.ok) return p.res;
  const { code, name, message, history, level, provider } = p.data;
  const ns = privateNamespace(code); // derived server-side; the browser never names a namespace

  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (o: unknown) => c.enqueue(ndjson(o));
      try {
        send({ type: "status", step: "recall" });
        const [mem, subjectMem, sources, initialLabel] = await Promise.all([
          // A slow/cold Walrus recall must not hold the answer hostage: after
          // ~6s we carry on without it (the UI then shows "memory unreachable").
          withTimeout(recallSafe(ns, message, { limit: 6, maxDistance: 0.8 }), recallTimeoutMs(), recallTimedOut()),
          // A broad, permissive recall of the precise subject/topic records
          // (see lib/topics.ts) — separate from freeform notes above, so
          // continuity doesn't depend on semantic luck.
          withTimeout(recallSafe(ns, "studied subject topic", { limit: 30, sort: "recent" }), recallTimeoutMs(), recallTimedOut()),
          shouldGround(message) ? groundOn(message) : Promise.resolve([]),
          currentModelLabel(provider),
        ]);
        const subjects = groupBySubject(subjectMem.notes.map((n) => parseTopicMemory(n.text)).filter((x): x is NonNullable<typeof x> => x !== null));
        const subjectsLine = summarizeSubjects(subjects);

        send({
          type: "meta",
          memoryOk: mem.ok,
          recalled: mem.notes.map((n) => ({ text: n.text, blobId: n.blobId, createdAt: n.createdAt })),
          sources: sources.map((s) => ({ title: s.title, url: s.url })),
          provider,
          model: initialLabel, // best guess; a "model" event below corrects it if a fallback answered
        });

        send({ type: "status", step: "think" });
        const messages: Msg[] = [
          { role: "system", content: tutorSystemPrompt({ name, level, notes: mem.notes.map((n) => n.text), subjectsLine, sources, memoryOk: mem.ok }) },
          ...history.slice(-12),
          { role: "user", content: message },
        ];
        // Connect first (this is where within-provider fallback happens), then
        // tell the browser which model REALLY answered — it can differ from the
        // label sent in `meta` if the top candidate was busy.
        const { model: answeredBy, stream: answer } = await openAnswerStream(provider as Provider, messages, { maxTokens: 900 });
        send({ type: "model", provider, model: modelLabel(provider as Provider, answeredBy) });
        let full = "";
        for await (const t of answer) {
          full += t;
          send({ type: "token", t });
        }

        send({ type: "status", step: "seal" });
        let learned: string[] = [];
        let sealError: string | undefined;
        let topic: { subject: string; topic: string } | null = null;
        if (message.length >= 12) {
          // Both writes happen regardless of which provider answered — this
          // is the actual point being demonstrated: memory is Walrus's job,
          // not Groq's or Gemini's.
          const [learnResult, topicResult] = await Promise.allSettled([
            learn(ns, `${name} (student) said: "${message}"\nTutor covered: ${full.slice(0, 300)}`),
            // Topic tagging always runs on Groq regardless of which provider
            // answered the student — it's an internal bookkeeping call, not
            // part of the visible conversation, and Groq's chatJson is
            // already fast, free, and validated; no need to duplicate that
            // for Gemini too just to categorize our own output.
            chatJson([{ role: "user", content: topicTagPrompt(message, full) }], (t) => TopicTag.parse(extractJson(t)), { maxTokens: 80 }),
          ]);
          if (learnResult.status === "fulfilled") learned = learnResult.value.facts;
          else {
            sealError = errMsg(learnResult.reason);
            console.error("[tutor] learn failed:", sealError);
          }
          if (topicResult.status === "fulfilled" && topicResult.value.subject && topicResult.value.topic) {
            topic = { subject: topicResult.value.subject, topic: topicResult.value.topic };
            try {
              await remember(ns, formatTopicMemory(topic.subject, topic.topic));
            } catch (e) {
              console.error("[tutor] topic remember failed (non-fatal):", e);
            }
          }
        }
        send({ type: "done", learned, sealError, topic });
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

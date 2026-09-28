import { NextRequest, NextResponse } from "next/server";
import { getMemWal } from "@/lib/memwal";
import { askGroq, type ChatMessage } from "@/lib/groq";
import { isValidCode, normalizeCode, privateNamespace } from "@/lib/identity";

// Give the route a little headroom on Vercel. Recall + Groq + analyze()
// (which only waits for job *acceptance*, not full indexing) should
// comfortably finish in a few seconds, but this leaves margin.
export const maxDuration = 30;

interface ChatRequestBody {
  /** The student's secret memory code. The SERVER derives the namespace from
   *  it; the browser is never allowed to name a namespace directly. */
  code: string;
  message: string;
  history: ChatMessage[];
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { message, history } = body;
  const code = normalizeCode(typeof body.code === "string" ? body.code : "");
  if (!isValidCode(code)) {
    return NextResponse.json({ error: "Invalid memory code." }, { status: 400 });
  }
  const namespace = privateNamespace(code);
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Missing message." }, { status: 400 });
  }

  const memwal = getMemWal();

  // 1. RECALL — pull anything relevant we already know about this student,
  //    scoped strictly to their own namespace (see lib/memwal.ts).
  let recalled: { text: string; distance: number }[] = [];
  try {
    const recall = await memwal.recall({
      query: message,
      namespace,
      limit: 5,
      maxDistance: 0.7,
    });
    recalled = recall.results.map((r) => ({ text: r.text, distance: r.distance }));
  } catch (err) {
    // Memory recall failing shouldn't take down the whole tutoring
    // session — log it and continue with no recalled context.
    console.error("MemWal recall failed:", err);
  }

  // 2. ASK — build a tutor system prompt that injects what we recalled.
  const memoryBlock = recalled.length
    ? recalled.map((m) => `- ${m.text}`).join("\n")
    : "(no prior memories yet — this may be a new student)";

  const systemPrompt = `You are Study Buddy, a patient, encouraging study tutor.
You have long-term memory about this specific student, shown below. Use it
naturally: don't re-explain things they already know, follow up on topics
they were struggling with, and reference their stated goals or exams when
relevant. Never say things like "according to my memory" — just act like a
tutor who remembers past sessions.

What you remember about this student:
${memoryBlock}

Keep answers focused and practical. Ask a short follow-up question when it
helps you understand what to teach next.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10), // keep the request small; MemWal carries the long-term context
    { role: "user", content: message },
  ];

  let reply: string;
  try {
    reply = await askGroq(messages);
  } catch (err) {
    console.error("Groq call failed:", err);
    return NextResponse.json(
      { error: "The tutor model is unavailable right now. Check GROQ_API_KEY." },
      { status: 502 }
    );
  }

  // 3. REMEMBER — extract durable facts from this exchange and store them
  //    on Walrus. analyze() returns the extracted fact text immediately
  //    (job acceptance), so the UI can show what was just learned without
  //    waiting for full on-chain indexing.
  let learned: string[] = [];
  try {
    const exchange = `Student said: "${message}"\nTutor replied: "${reply}"`;
    const analyzed = await memwal.analyze(exchange, namespace);
    learned = analyzed.facts.map((f) => f.text);
  } catch (err) {
    console.error("MemWal analyze/remember failed:", err);
  }

  return NextResponse.json({ reply, recalled, learned });
}

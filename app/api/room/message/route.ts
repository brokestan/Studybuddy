import { NextRequest, NextResponse } from "next/server";
import { getMemWal } from "@/lib/memwal";
import { askGroq } from "@/lib/groq";
import { saveRoomMessage, recentRoomMessages } from "@/lib/roomStore";
import { runRoomTurn, type RoomDeps } from "@/lib/roomAgent";
import { isValidCode, normalizeCode, isValidRoomId, normalizeRoomId } from "@/lib/identity";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { roomId?: string; code?: string; name?: string; content?: string; askBuddy?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const roomId = normalizeRoomId(body.roomId ?? "");
  const code = normalizeCode(body.code ?? "");
  const name = (body.name ?? "").trim().slice(0, 30) || "Student";
  const content = (body.content ?? "").trim().slice(0, 1000);

  if (!isValidRoomId(roomId)) return NextResponse.json({ error: "Invalid room code." }, { status: 400 });
  if (!isValidCode(code)) return NextResponse.json({ error: "Invalid memory code." }, { status: 400 });
  if (!content) return NextResponse.json({ error: "Empty message." }, { status: 400 });

  const memwal = getMemWal();
  const deps: RoomDeps = {
    recallPrivate: async (namespace, query, limit) =>
      (await memwal.recall({ query, namespace, limit, maxDistance: 0.7 })).results.map((r) => r.text),
    recallRoom: async (namespace, query, limit) =>
      (await memwal.recall({ query, namespace, limit, maxDistance: 0.7 })).results.map((r) => r.text),
    recentMessages: recentRoomMessages,
    generate: (system, user) =>
      askGroq([
        { role: "system", content: system },
        { role: "user", content: user },
      ]),
    saveMessage: saveRoomMessage,
    ingestPrivate: async (namespace, text) => (await memwal.analyze(text, namespace)).facts.map((f) => f.text),
    ingestRoom: async (namespace, text) => {
      await memwal.remember(text, namespace);
    },
  };

  try {
    const result = await runRoomTurn(deps, {
      roomId,
      speakerCode: code,
      speakerName: name,
      content,
      askBuddy: Boolean(body.askBuddy),
    });
    // R4: private-notes info goes back to the SENDER only; it is not stored.
    return NextResponse.json({
      usedPrivateNotes: result.usedPrivateNotes,
      learnedPrivate: result.learnedPrivate,
      guard: result.guard,
    });
  } catch (err) {
    console.error("room turn failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Room turn failed." },
      { status: 502 }
    );
  }
}

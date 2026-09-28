import { NextRequest, NextResponse } from "next/server";
import { roomMessagesAfter, recentRoomMessages } from "@/lib/roomStore";
import { isValidRoomId, normalizeRoomId } from "@/lib/identity";

// Polling endpoint. The browser asks every ~2.5s for messages newer than the
// last one it has. (World Arena used Supabase Realtime for this; polling needs
// zero Supabase dashboard configuration, which is friendlier for a first build.)
export async function GET(req: NextRequest) {
  const roomId = normalizeRoomId(req.nextUrl.searchParams.get("roomId") ?? "");
  const after = req.nextUrl.searchParams.get("after");
  if (!isValidRoomId(roomId)) return NextResponse.json({ error: "Invalid room code." }, { status: 400 });

  try {
    const messages = after ? await roomMessagesAfter(roomId, after) : await recentRoomMessages(roomId, 50);
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}

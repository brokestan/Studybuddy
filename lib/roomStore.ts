import "server-only";
import { getSupabase } from "./supabase";
import type { RoomMessage } from "./roomAgent";

interface Row {
  id: string;
  room_id: string;
  speaker_id: string;
  display_name: string;
  kind: "user" | "agent";
  addressed_to_name: string | null;
  content: string;
  created_at: string;
}

const fromRow = (r: Row): RoomMessage => ({
  id: r.id,
  roomId: r.room_id,
  speakerId: r.speaker_id,
  displayName: r.display_name,
  kind: r.kind,
  addressedToName: r.addressed_to_name,
  content: r.content,
  createdAt: r.created_at,
});

export async function saveRoomMessage(m: RoomMessage): Promise<void> {
  const { error } = await getSupabase().from("room_messages").insert({
    room_id: m.roomId,
    speaker_id: m.speakerId,
    display_name: m.displayName,
    kind: m.kind,
    addressed_to_name: m.addressedToName ?? null,
    content: m.content,
  });
  if (error) throw new Error(`saveRoomMessage: ${error.message}`);
}

/** Newest `limit` messages, returned oldest-first. */
export async function recentRoomMessages(roomId: string, limit: number): Promise<RoomMessage[]> {
  const { data, error } = await getSupabase()
    .from("room_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recentRoomMessages: ${error.message}`);
  return ((data ?? []) as Row[]).reverse().map(fromRow);
}

/** Messages strictly newer than `after` (ISO string), oldest-first. */
export async function roomMessagesAfter(roomId: string, after: string, limit = 100): Promise<RoomMessage[]> {
  const { data, error } = await getSupabase()
    .from("room_messages")
    .select("*")
    .eq("room_id", roomId)
    .gt("created_at", after)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`roomMessagesAfter: ${error.message}`);
  return ((data ?? []) as Row[]).map(fromRow);
}

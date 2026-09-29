import "server-only";

// Supabase is used ONLY as a stateless live wire for the Study Room (Realtime
// Broadcast). It stores nothing — no tables, no history. All memory, including
// room history, lives on Walrus. The server pushes messages over Supabase's
// documented REST broadcast endpoint using the public anon key.
export const roomTopic = (roomId: string) => `sb-room-${roomId}`;

const cfg = () => ({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
export const realtimeConfigured = () => {
  const { url, anon } = cfg();
  return Boolean(url && anon);
};

export async function broadcast(topic: string, event: string, payload: unknown): Promise<{ ok: boolean; status: number }> {
  const { url, anon } = cfg();
  if (!url || !anon) throw new Error("Live Study Room is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.");
  const res = await fetch(`${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ messages: [{ topic, event, payload }] }),
    signal: AbortSignal.timeout(6000),
  });
  return { ok: res.ok, status: res.status };
}

export async function publishToRoom(roomId: string, payload: unknown): Promise<void> {
  const r = await broadcast(roomTopic(roomId), "msg", payload);
  if (!r.ok) throw new Error(`Live channel rejected the message (HTTP ${r.status}). Check the Supabase URL/anon key on the Status page.`);
}

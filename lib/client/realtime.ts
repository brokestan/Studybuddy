import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase here is only a live wire (Realtime Broadcast + Presence). It stores nothing.
// NEXT_PUBLIC_* values are safe to ship to the browser by design.
let client: SupabaseClient | null | undefined;

export function browserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && anon ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return client;
}

export const roomTopic = (roomId: string) => `sb-room-${roomId}`;

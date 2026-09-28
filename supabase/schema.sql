-- Run this ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- The only table Study Room needs. Memory itself lives on Walrus, not here;
-- this table only holds the visible chat transcript of each room.

create table if not exists public.room_messages (
  id               uuid primary key default gen_random_uuid(),
  room_id          text not null,
  speaker_id       text not null,          -- hashed id, never the secret code
  display_name     text not null,
  kind             text not null check (kind in ('user', 'agent')),
  addressed_to_name text,
  content          text not null,
  created_at       timestamptz not null default now()
);

create index if not exists room_messages_room_time
  on public.room_messages (room_id, created_at);

-- Lock the table down: with RLS on and NO policies, the public/anon key can
-- read and write nothing. Only our server (service-role key) touches it, and
-- the server only returns rows for the room ID the caller presents.
alter table public.room_messages enable row level security;

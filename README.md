# Study Buddy — a tutor that remembers you, privately and in a group

Built for **Walrus Sessions: Chatbots That Remember** (deadline **Oct 9, 2026, 2:00 PM UTC**).

Two modes, one memory system (Walrus Memory / MemWal, mainnet):

| | **Private tutor** (`/`) | **Study Room** (`/room`) |
|---|---|---|
| Who talks | you and Buddy, 1-to-1 | several friends + Buddy, one shared chat |
| Memory written | your private namespace | private notes stay private; what people *say in the room* goes to a shared room namespace |
| Memory read | your private namespace | **the speaker's** private notes (to adapt + fact-check) **and** the shared room memory |

**The idea worth showing judges:** in the room, Buddy quietly reads the *current speaker's* private notes to
(a) pitch answers differently for different people and (b) fact-check claims ("I've mastered integration by
parts") by testing them — but it can never reveal those notes to the room, and that is enforced in code and tests,
not just by asking the model nicely.

- **LLM:** Groq → `qwen/qwen3.8-27b` (Qwen, open-weight, free tier) → also eligible for *Beyond the Big Two*.
- **Memory:** `@mysten-incubation/memwal` on the mainnet relayer.
- **Hosting:** Vercel free tier. **Database:** Supabase free tier (Study Room transcript only).

---

## 0. Verify it before you add any keys

```bash
npm install
npm test        # 8 privacy tests, no API keys needed
npm run build
```

`npm test` runs two fake students (Sam, Alex) and a deliberately misbehaving model against the room logic.
It proves: private notes are read only for the speaker; a leaking reply is retried then blocked; the agent's
reply and private notes never reach shared memory; namespaces never contain the raw secret code.

## 1. Accounts and keys (all free)

1. **Groq** — https://console.groq.com/keys → `GROQ_API_KEY`
2. **Walrus Memory** — https://memory.walrus.xyz (mainnet) → `MEMWAL_ACCOUNT_ID` + `MEMWAL_PRIVATE_KEY`
3. **Supabase** (Study Room only) — new project → *Project Settings → API* → `SUPABASE_URL` and the
   **service_role** key → then *SQL Editor* → paste `supabase/schema.sql` → Run.

Copy `.env.example` to `.env.local` and fill it in. The private key and service-role key are **server secrets**:
never `NEXT_PUBLIC_`, never committed, never in the browser.

```bash
npm run dev
```
Open http://localhost:3000/api/health — you want `"memwalOk": true` and `"groqKeyPresent": true`.

## 2. Manual test (10 minutes) — this is also your article's evidence

1. Browser A: **Private tutor** → "I'm new here" → save the memory code → say *"I keep failing integration by
   parts, and I learn best from worked examples."* Expect a green 🌱 badge.
2. Browser B (incognito, different name, new profile): say *"I want short answers, I'm prepping the SAT."*
3. Browser A: **Study room → Create a new room** → copy the room code.
   Browser B: **Study room → Join** with that code.
4. Browser A types *"I've totally mastered integration by parts"* → **Ask Buddy**.
   Expect Buddy to *test* the claim with a practice question, **not** to say "my notes say you struggle".
   Only Browser A sees the `🔒 Buddy used N private notes about you` line.
5. Browser B types the same kind of question → **Ask Buddy**. Expect a shorter, differently-pitched answer.
6. Browser A refreshes / uses the same memory code on your phone → memory is still there (portable).

Write down what happened, screenshot it. That's your before/after.

**Isolation proof for the article:** set `ENABLE_DEV_TESTS=true`, then
`curl -X POST localhost:3000/api/dev/isolation-test -H 'content-type: application/json' -d '{"code":"<your code>"}'`.
It writes near-identical text into a private and a shared namespace on **mainnet**, checks neither recall sees the
other, and returns the blob IDs. (Each is a real mainnet blob toward your 10.)

## 3. How identity and privacy work

- **Memory code** = your secret. 16 random characters (~79 bits). Treat it like a password.
- The browser sends only the code. The **server** derives every namespace:
  `private = sb-u-<sha256(code)>`, `room = sb-r-<roomId>`. The browser can't name a namespace, and the relayer
  never sees the raw code. (v1 trusted a browser-supplied namespace; that hole is closed.)
- Rules enforced in `lib/roomAgent.ts` and covered by `tests/room.test.ts`:
  - **R1** Private notes are read only for the *verified speaker* of the message being answered.
  - **R2** A deterministic guard (`lib/leakGuard.ts`) blocks replies that reproduce private wording:
    retry once, then a safe fallback.
  - **R3** Only the speaker's own words (public in the room anyway) go to shared memory.
  - **R4** "Which private notes were used" goes back to the sender only and is never stored in the transcript.

**Honest limits (say these in your article — judges like honesty):**
- MemWal namespaces are an *organizational* boundary: your server's delegate key can technically read every
  namespace under the account. The privacy comes from *your code* (above), not from Walrus.
- The guard catches quoting/close copying, not every possible paraphrase or inference. A reply like
  "let's test that" still hints that Buddy has some reason to. That is a deliberate trade-off.
- No login system: whoever holds a memory code is that person. Anyone with a room code can read and join that room.
- No rate limiting. Fine for a demo; add it before real traffic.

## 4. Deploy (Vercel free)

Push to a **public GitHub repo** → vercel.com → Import → add the env vars from `.env.example` → Deploy →
check `/api/health` on the live URL → run the manual test above on the live URL with real friends.
`app/api/*/route.ts` set `maxDuration = 30`; if Vercel Hobby rejects it, lower it.

## 5. Timeline (today is Sep 28; deadline Oct 9, 2:00 PM UTC)

- **Sep 28–29** keys, run locally, pass the manual test.
- **Sep 30** deploy to Vercel; test on the live URL.
- **Oct 1–4** get 3–5 real people to use it across two separate days (that's your "real-world use" evidence).
- **Oct 4–6** write the article; file GitHub issues (see §7); register on DeepSurge.
- **Oct 7–8** submission form, X post, wallet address; fix anything that broke.
- **Oct 9** buffer. Don't plan to submit in the last hour.

## 6. What was reused from the World Arena repo

| Reused / adapted | Where it came from |
|---|---|
| Server-side derivation of namespaces (never trust the client) | `lib/memwal/namespace.ts` idea → `lib/identity.ts` |
| Private-vs-shared split and a *narrow, explicit* pathway between them | `lib/memwal/sharing.ts` (`mirrorToShared`) → rule R3 |
| Isolation evidence route | `app/api/dev/memory-test/route.ts` → `/api/dev/isolation-test` |
| "Agent never gets X" enforced structurally, not by prompt | Historian route → R1/R2 |
| Group chat transcript in Supabase | `lib/supabase/arena.ts` → `lib/roomStore.ts` (polling instead of Realtime) |
| Not reused on purpose | Sui wallet sign-in (your classmates won't have wallets), Gemini (2.5 Flash shuts down Oct 16), football/ESPN code |

If you later want Realtime instead of polling, the subscription code in World Arena's `app/arena/chat-client.tsx`
drops straight in.

## 7. Friction points you actually hit (file these as GitHub issues — Bug Bounty + required feedback)

1. `@mysten-incubation/memwal` `"^0.0.1"` silently resolves to a very old API because caret ranges on `0.0.x` are exact.
2. Docs describe `recall({ query, ... })`, job-based `remember`, `*AndWait`; older published versions don't have them.
3. Env var naming drift: `MEMWAL_KEY` vs `MEMWAL_PRIVATE_KEY` across docs/examples.
4. No API to *list* memories in a namespace; "show everything" has to be a broad query with a high limit.
5. Namespace is not a security boundary against your own delegate key (documented, but easy to miss).
6. Groq retired `llama-3.3-70b-versatile` (Aug 16) and `qwen3.6-27b` (Sep 14) within weeks — model ids must be env-configurable.

Include: steps to reproduce, expected vs actual, model + runtime, OS, SDK version (`npm ls @mysten-incubation/memwal`).

## 8. Submission checklist

Public GitHub repo · live URL · ≥10 mainnet blobs (agent ID + count in DeepSurge form) · LLM stated (Groq / Qwen 3.8 27B) ·
dedicated wallet address · article on Medium/Inkray (what it does, how you integrated MemWal, before/after, evidence) ·
feedback form + GitHub issues · Discord joined · X post tagging @WalrusProtocol with #WalrusMemory · DeepSurge registration ·
Airtable submission form.

## Project structure

```
app/page.tsx                    private tutor UI
app/room/page.tsx               study room UI (polls every 2.5s)
app/api/chat/route.ts           private tutor: recall → Groq → analyze
app/api/room/message/route.ts   room turn (wires real services into lib/roomAgent.ts)
app/api/room/messages/route.ts  room polling
app/api/dev/isolation-test/     evidence generator (off unless ENABLE_DEV_TESTS=true)
lib/identity.ts                 code → namespaces (pure, server-side)
lib/leakGuard.ts                deterministic output guard
lib/prompts.ts                  room prompt with disclosure policy
lib/roomAgent.ts                the privileged-tutor turn, dependency-injected
lib/memwal.ts  lib/groq.ts  lib/supabase.ts  lib/roomStore.ts   service wiring
supabase/schema.sql             the one table
tests/room.test.ts              8 privacy tests
```

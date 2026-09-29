# Study Buddy — a tutor that remembers you, alone and in a group

Built for **Walrus Sessions: Chatbots That Remember** (deadline Oct 9, 2026, 2:00 PM UTC).
Memory lives entirely on **Walrus Memory (MemWal)**, mainnet. There is no other database for memory.

**What's here:** a 1-on-1 Tutor (streaming answers, Wikipedia-grounded, explanation-level picker), a
personalized session-opener, Quiz and Flashcards generated from what you actually struggle with, a
"Memory Lens" that shows every memory Walrus holds about you, a live multi-person **Study Room** where
Buddy privately reads *the current speaker's* memory to adapt and fact-check without ever leaking it to
the room, and a **Status** page that checks your whole setup with no terminal required.

- **LLM:** Groq. The app **asks Groq which models currently exist** and picks the best eligible
  open-weight one itself (currently resolves to `qwen/qwen3.8-27b`) — see §3, this is the fix for
  "old hardcoded model" problems.
- **Memory:** `@mysten-incubation/memwal` 0.1.8, mainnet relayer.
- **Live wire only (not memory):** Supabase Realtime *Broadcast* — see §6, this directly answers
  "Supabase shouldn't touch memory."
- **Hosting:** Vercel free tier.

---

## 1. You do not run anything locally

You add two free API keys in Vercel's dashboard and click Deploy. That's it — no terminal, no `npm`.
I already ran `npm install`, the full type-checker, the production build, **63 automated checks** (27
unit tests + 36 end-to-end scenario tests against a real built server), and a visual review of every
page in light/dark/mobile before handing this to you. `npm` only runs *once more*, automatically, inside
Vercel's own build servers when you deploy — you never type it.

## 2. Get your three free things

1. **Groq** (LLM) — https://console.groq.com/keys → copy the key.
2. **Walrus Memory** (mainnet) — https://memory.walrus.xyz → creates an account, gives you an
   **account ID** and a **private key**.
3. **Supabase** (only for the live Study Room wire) — new project at supabase.com (free tier) →
   *Project Settings → API* → copy the **Project URL** and the **anon public key**. No table, no SQL,
   nothing to run — Broadcast needs no schema.

## 3. Deploy

1. Push this folder to a **public GitHub repo**.
2. vercel.com → Add New Project → import the repo → Framework auto-detects Next.js.
3. Before deploying, add these Environment Variables (Project Settings → Environment Variables):

   | Name | Value |
   |---|---|
   | `GROQ_API_KEY` | from console.groq.com |
   | `MEMWAL_PRIVATE_KEY` | from memory.walrus.xyz |
   | `MEMWAL_ACCOUNT_ID` | from memory.walrus.xyz |
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase → API settings |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase → API settings |
   | `ENABLE_DEV_TESTS` | `true` (optional — enables the isolation-proof button on Status) |

4. Deploy. Open `https://<your-app>.vercel.app/status` — every row should be green.
   If a row is red, it tells you the exact variable name to fix.

## 4. The one thing I could not verify myself, and how to check it in 30 seconds

I do not have a Supabase account in my sandbox, and Supabase's servers are outside the small list of
sites my container is allowed to reach — so I could not test actual live-message delivery over a real
Supabase Realtime WebSocket. What I *did* verify: the server correctly derives the right topic, sends
the right payload, sends exactly one broadcast for the student's message and one for Buddy's reply, and
the browser subscribes to that exact topic/event. What I could not verify: whether that subscription
reaches "connected" against your real project and whether messages actually arrive.

**Please test this first, before relying on it for judging:** open the Study Room on two devices (or one
normal window + one incognito window) signed in as two different profiles, create a room on one, join
it with the code on the other, and send a message. It should appear on both within about a second, and
the "Connecting…" pill should say "Live". If it doesn't: the Status page's "Live Study Room" row will
tell you which Supabase variable to check first. This is standard, well-documented Supabase behavior
(their free tier supports Broadcast out of the box, no special setup) — I simply have no way to click
"try it" myself from here.

## 5. What Walrus Memory actually does in this app

- **Private tutor memory** — every message you send is analyzed for durable facts (goals, exam dates,
  what you got wrong, how you like to learn) and stored under a namespace derived from your **memory
  key** (`sb-u-<hash>`). Every tutor reply, quiz result, and flashcard review recalls from this namespace
  first, so answers are shaped by what you actually need.
- **Shared room memory** — what people say *out loud* in a Study Room is stored under a namespace derived
  from the room code (`sb-r-<roomId>`). This is also how room history works for a person who joins
  late — there is no chat-log database; the recap is a **Walrus recall**, live.
- **The privileged-agent trick you asked for** — when you tag Buddy in a room, it reads two things:
  the shared room memory (public to everyone), and — **only for the person who just spoke** — that
  person's own private tutor memory. It uses the private read for two things only: (1) quietly pitching
  its answer at the right level for that person, and (2) **fact-checking** — if you claim "I've
  mastered X" and your private notes say you failed two quizzes on X, Buddy doesn't call you out; it
  poses a test question that lets the room see the truth for itself. It is built so it **cannot**
  reveal the private note's wording: every reply is checked by a deterministic guard
  (`lib/leakGuard.ts`) before it's ever shown to anyone, retried once if it fails, and replaced with a
  safe fallback if it fails twice. `tests/room.test.ts` proves this with a model that is deliberately
  written to misbehave.

## 6. Why Supabase is not, and cannot become, your memory

Supabase here is used for exactly one thing: **Realtime Broadcast**, a fire-and-forget pub/sub wire with
no backing table. There is no `room_messages` table, no `CREATE TABLE` anywhere in this repo — search it
yourself. Every durable fact this app remembers is written through `lib/memory.ts`, and that file only
ever talks to Walrus. If Supabase disappears entirely, the Tutor, Quiz, Flashcards and Memory pages keep
working perfectly; only the *live* multi-person chat feed stops (room history itself would still be
intact on Walrus, recoverable the moment Realtime comes back).

## 7. What changed from what you'd uploaded to github.com/brokestan/Studybuddy

Short version: **replace the whole repo with this folder's contents.** Almost everything changed:

- **Model freshness (your main complaint):** the old build hardcoded `qwen/qwen3.8-27b` as a string
  with no fallback. This build calls Groq's `/models` endpoint, filters out anything not eligible
  (Anthropic/OpenAI-made, speech, guard, or embedding models), ranks what's left, and picks the newest
  working one automatically (`lib/modelPicker.ts`, `lib/llm.ts`). A test (`tests/core.test.ts`) proves
  that even if today's model gets retired tomorrow, the app keeps working without a code change.
- **Supabase's role:** old build stored the room transcript in a `room_messages` Postgres table
  (`supabase/schema.sql`, `lib/roomStore.ts`) — exactly what you objected to. That table and that file
  are gone. Room history is now recalled from Walrus; Supabase only broadcasts.
- **Framework versions:** Next.js 14 → 16, React 18 → 19, all other dependencies bumped to their current
  `latest` as of Sep 28, 2026 (checked live against npm, not from memory).
- **New surface area:** Quiz, Flashcards, Memory Lens, a personalized session-opener, Wikipedia-grounded
  answers with citations, an explanation-level picker (ELI5 → expert), a Status/setup-check page, and a
  fully redesigned dark/light UI with a mobile tab bar. None of this existed in the old build.
- **Identity:** same idea (a portable secret "memory key" instead of login), rebuilt with server-side
  namespace derivation (`lib/identity.ts`) so the browser can never name its own namespace — it presents
  only its key, and the server hashes it. The old build trusted a client-supplied namespace string.

## 8. Project map

```
app/
  layout.tsx                     fonts, theme boot script, wraps everything in AppShell
  globals.css                    the entire design system (tokens, dark+light, mobile)
  page.tsx                       Tutor: streaming chat, memory trace badges, level picker
  quiz/page.tsx                  Quiz: setup → play → scored results, saved to memory
  cards/page.tsx                 Flashcards: setup → flip deck → "again/got it", saved to memory
  room/page.tsx                  Study Room: live multi-person chat over Supabase Broadcast
  memory/page.tsx                Memory Lens: everything Walrus remembers, by category
  status/page.tsx                setup checker + one-click isolation proof
  api/
    tutor/route.ts               recall → (Wikipedia ground) → stream → seal, as NDJSON
    tutor/open/route.ts          personalized greeting built from recalled memory
    quiz/generate, quiz/submit   quiz creation + result sealed to memory
    cards/generate, cards/review flashcard deck creation + struggles sealed to memory
    memory/lens/route.ts         categorized read of a student's whole memory
    room/message/route.ts        one room turn: private read → guard → broadcast → learn
    room/recap/route.ts          room history recalled from Walrus (no database)
    status/route.ts              live check of Groq / Walrus / Supabase, secrets never returned
    proof/isolation/route.ts     writes real mainnet blobs, proves private/shared never leak

components/
  AppShell.tsx        sidebar (desktop) + tab bar (mobile) + theme toggle + profile chip
  Onboarding.tsx       first-run: new profile (shows + saves memory key) or restore-by-key
  ProfileProvider.tsx  the memory-key identity, in React context
  MemoryTrace.tsx      the recall/learned badges — the visible proof memory is doing real work
  Markdown.tsx         renders answers with GFM + LaTeX ($...$, $$...$$)
  Logo.tsx             app mark

lib/
  identity.ts          memory key / room id -> namespace (server-only, hashed, pure + tested)
  memory.ts             the ONLY file that talks to Walrus (recall/learn/remember/stats/health)
  llm.ts                 Groq client: auto-picks a live model, retries around retirements
  modelPicker.ts         pure model-selection + eligibility logic (heavily tested)
  roomAgent.ts            the privileged-read + leak-guard turn logic, dependency-injected & tested
  leakGuard.ts             deterministic "did the reply reproduce private wording" check
  prompts.ts               every system prompt, in one readable place
  wiki.ts                  Wikipedia grounding (free, no key, fails safe to [])
  quizJson.ts              validates/repairs the model's quiz & flashcard JSON, shuffles answers
  schemas.ts               zod input validation for every API route
  http.ts, rateLimit.ts, sse.ts   small server plumbing
  realtime.ts              stateless Supabase Broadcast sender (server side)
  client/                  browser-only: profile storage, streaming reader, Supabase subscriber

tests/
  core.test.ts    27 tests: model picking, think-tag stripping, SSE parsing, Wikipedia parsing,
                  rate limiting, quiz/flashcard JSON validation + shuffle correctness, prompts
  room.test.ts    9 tests: private reads never cross users, the leak guard retries then falls
                  back, only public words reach shared memory, room isolation
```

## 9. Submission checklist

Public GitHub repo (this repo) · live Vercel URL · ≥10 mainnet blobs (Status page shows your live count)
· LLM stated: **Groq — Qwen 3.8 27B, auto-selected** (also qualifies for *Beyond the Big Two*) · dedicated
wallet address for payout · article on Medium/Inkray with a real before/after (the Tutor's recall/learned
badges and the Room's private-note badge are your screenshots) · MemWal feedback form + a GitHub issue
(the model-picker fix and the Supabase-Realtime-can't-be-mock-tested finding below are both genuine,
reportable friction) · join Discord · X post tagging @WalrusProtocol with #WalrusMemory · DeepSurge
registration · Airtable submission form.

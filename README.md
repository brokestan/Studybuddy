# Study Buddy

A tutor chatbot that remembers you. It keeps track of what you are studying, where you struggle and how you like things explained, whether you chat alone or inside a study group room. The memory is stored on Walrus Memory (mainnet), so it stays the same when you switch models or return on another day.

Live: https://studybudyy.vercel.app

## What it does

- Recalls the memories that match your message before every reply and gives them to the model.
- Saves the facts worth keeping after every reply: subject, goals, weak topics, preferred explanation style.
- Works in private chat and in group rooms. In rooms, only public messages reach shared memory, and each room is kept separate.
- Lets you switch models mid-chat without losing anything, because memory lives in Walrus and not in the model.
- Memory Lens (`/memory`) shows everything Walrus remembers about the current student, by category.

## Models

| Provider | Model |
| --- | --- |
| Groq | `qwen/qwen3.8-27b` |
| Google | `gemini-3.8-flash` |
| Google | `gemini-3.6-flash` |

## How memory is built

All durable memory goes through `lib/memory.ts`, and that file only talks to Walrus Memory through `@mysten-incubation/memwal` 0.1.8 on the mainnet relayer. Supabase is used only to broadcast live messages in group rooms. It does not store memory.

## Stack

Next.js, React, TypeScript, Walrus Memory, Supabase (live rooms only). Requires Node.js 20 or newer.

## Environment variables

| Name | Where to get it |
| --- | --- |
| `GROQ_API_KEY` | console.groq.com |
| `GEMINI_API_KEY` | aistudio.google.com |
| `MEMWAL_PRIVATE_KEY` | memory.walrus.xyz, delegate key |
| `MEMWAL_ACCOUNT_ID` | memory.walrus.xyz, shown after you create the delegate key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase, API settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase, API settings |
| `ENABLE_DEV_TESTS` | optional, set to `true` to show the isolation test button |

## Tests

The `tests` folder covers the memory behavior, including checks that one room or profile cannot read another's memories.

```
npm test
```

This runs every `tests/*.test.ts` file with Node's built-in test runner. Tests that reach Walrus need the Walrus variables above to be set.

## Deploy

Built for Vercel. Add the variables above under Project Settings, then deploy.

## Notes

Never commit your Walrus private key or any `.env` file.

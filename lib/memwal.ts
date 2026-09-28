import "server-only";
import { MemWal } from "@mysten-incubation/memwal";

/**
 * One MemWal client for the whole deployed app.
 *
 * Every end user of the app shares the same Walrus Memory *account*
 * (the MEMWAL_ACCOUNT_ID + MEMWAL_KEY below), but each end user gets
 * their own *namespace* (see lib/id.ts + app/api/chat/route.ts).
 * Namespace is the isolation boundary in MemWal: recall() in one
 * namespace can never see memories written to another namespace, even
 * under the same account. That's how one deployed bot safely serves
 * many different real people without their memories mixing.
 */
let client: MemWal | null = null;

export function getMemWal(): MemWal {
  if (client) return client;

  // MEMWAL_PRIVATE_KEY is the name Walrus's own docs use; MEMWAL_KEY still works.
  const key = process.env.MEMWAL_PRIVATE_KEY ?? process.env.MEMWAL_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  const serverUrl =
    process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz";

  if (!key || !accountId) {
    throw new Error(
      "Missing MEMWAL_PRIVATE_KEY or MEMWAL_ACCOUNT_ID. Get both for free at https://memory.walrus.xyz and put them in .env.local (locally) or your Vercel project's Environment Variables (in production)."
    );
  }

  client = MemWal.create({
    key,
    accountId,
    serverUrl,
    // Default namespace if a call ever forgets to pass one explicitly.
    // Real per-user isolation always passes an explicit namespace below.
    namespace: "studybuddy-default",
  });

  return client;
}

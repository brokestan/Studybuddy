import "server-only";
import { MemWal, MemWalMock } from "@mysten-incubation/memwal";

// Every durable thing this app remembers goes through this file, and every
// byte of it lives on Walrus (mainnet relayer). There is no other database.

export interface Note {
  text: string;
  blobId: string;
  createdAt?: string;
  distance?: number;
}

interface RecallArgs {
  query: string;
  namespace?: string;
  limit?: number;
  maxDistance?: number;
  sort?: "relevance" | "recent";
}
interface Client {
  recall(p: RecallArgs): Promise<{ results: { blob_id: string; text: string; distance: number; created_at?: string }[] }>;
  analyze(text: string, namespace?: string): Promise<{ facts: { text: string; id: string }[] }>;
  remember(text: string, namespace?: string): Promise<unknown>;
  rememberAndWait(text: string, namespace?: string): Promise<{ blob_id: string }>;
  health(): Promise<unknown>;
  listNamespaces(o?: { cursor?: string; limit?: number }): Promise<{
    namespaces: { id: string; name: string; memory_count: number }[];
    next_cursor: string | null;
    has_more: boolean;
  }>;
}

const g = globalThis as unknown as { __sbMemwal?: Client; __sbMock?: Client };

/** MEMWAL_MOCK=true swaps in the SDK's offline in-memory client. Used only for automated tests. */
export const isMock = () => process.env.MEMWAL_MOCK === "true";

export function memwalEnv() {
  return {
    key: process.env.MEMWAL_PRIVATE_KEY ?? process.env.MEMWAL_KEY,
    accountId: process.env.MEMWAL_ACCOUNT_ID,
    serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
  };
}

export function client(): Client {
  if (isMock()) return (g.__sbMock ??= MemWalMock.create({ namespace: "studybuddy" }) as unknown as Client);
  if (g.__sbMemwal) return g.__sbMemwal;
  const { key, accountId, serverUrl } = memwalEnv();
  if (!key || !accountId) {
    throw new Error("Walrus Memory is not configured: set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID in Vercel → Settings → Environment Variables.");
  }
  g.__sbMemwal = MemWal.create({ key, accountId, serverUrl, namespace: "studybuddy-default" }) as unknown as Client;
  return g.__sbMemwal;
}

const toNote = (r: { blob_id: string; text: string; distance: number; created_at?: string }): Note => ({
  text: r.text,
  blobId: r.blob_id,
  createdAt: r.created_at,
  distance: r.distance,
});

/** Never throws: a memory outage must not take the whole tutor down. */
export async function recallSafe(
  namespace: string,
  query: string,
  o: { limit?: number; maxDistance?: number; sort?: "relevance" | "recent" } = {}
): Promise<{ notes: Note[]; ok: boolean; error?: string }> {
  try {
    const r = await client().recall({ query, namespace, limit: o.limit ?? 5, maxDistance: o.maxDistance, sort: o.sort });
    return { notes: r.results.map(toNote), ok: true };
  } catch (e) {
    console.error("[memory] recall failed:", e instanceof Error ? e.message : e);
    return { notes: [], ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Extract durable facts from an exchange and store each on Walrus. */
export async function learn(namespace: string, text: string): Promise<{ facts: string[]; ids: string[] }> {
  const r = await client().analyze(text, namespace);
  return { facts: r.facts.map((f) => f.text), ids: r.facts.map((f) => f.id) };
}

/** Store one memory verbatim (used for quiz/flashcard results). */
export async function remember(namespace: string, text: string): Promise<void> {
  await client().remember(text, namespace);
}

/** Memory counts from the relayer: this namespace, and the whole account (≈ blobs written). */
export async function stats(namespace?: string): Promise<{ mine: number | null; total: number }> {
  let total = 0;
  let mine: number | null = null;
  let cursor: string | undefined;
  for (let page = 0; page < 6; page++) {
    const r = await client().listNamespaces({ cursor, limit: 500 });
    for (const n of r.namespaces) {
      total += n.memory_count;
      if (namespace && n.name === namespace) mine = n.memory_count;
    }
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return { mine: namespace ? mine ?? 0 : null, total };
}

export const health = () => client().health();
export const writeAndWait = (namespace: string, text: string) => client().rememberAndWait(text, namespace);

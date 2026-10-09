import "server-only";
import { z } from "zod";
import { rateLimit } from "./rateLimit";

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (error: string, status = 400) => json({ error }, status);

/** Returns a 429 Response if the caller is over the limit, else null. */
export function limited(req: Request, route: string, limit: number, windowMs = 60_000): Response | null {
  const r = rateLimit(`${route}:${clientIp(req)}`, limit, windowMs);
  return r.ok ? null : Response.json({ error: `Slow down a little — try again in ${r.retryAfterSec}s.` }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
}

export async function parse<S extends z.ZodType>(req: Request, schema: S): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: fail("Invalid JSON body.") };
  }
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, res: fail(r.error.issues[0]?.message ?? "Invalid request.") };
  return { ok: true, data: r.data };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Resolves with `promise`'s value, or with `fallback` if it hasn't settled in
 * `ms`. For slow-but-optional work (a Walrus recall on a cold start) where the
 * right move is "carry on without it" rather than leave the student staring
 * at a spinner. The underlying work is not cancelled — it just can no longer
 * hold the response up — and a late failure is swallowed so it can't surface
 * as an unhandled rejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

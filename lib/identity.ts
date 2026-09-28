// Server-side identity + namespace derivation. Pure (no Next.js imports) so it
// can be unit-tested. NEVER import this from a client component.
//
// Why this exists: in v1 the browser sent the raw namespace string and the
// server trusted it, so a client could ask for ANY namespace (another person's,
// or a room's). Now the browser sends only its secret memory code and the
// server derives the namespace itself. The code is hashed, so the relayer
// never even sees the raw secret.
import { createHash } from "node:crypto";

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function normalizeCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export function isValidCode(code: string): boolean {
  return /^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$/.test(code);
}

/** A student's PRIVATE memory space. */
export function privateNamespace(code: string): string {
  return `sb-u-${sha(`user:${normalizeCode(code)}`).slice(0, 40)}`;
}

/** Public-facing stable id for a person in a room (safe to store/show). */
export function speakerIdFor(code: string): string {
  return sha(`speaker:${normalizeCode(code)}`).slice(0, 12);
}

export function normalizeRoomId(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

export function isValidRoomId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/.test(id);
}

/** A study room's SHARED memory space (what people said in that room). */
export function roomNamespace(roomId: string): string {
  return `sb-r-${normalizeRoomId(roomId)}`;
}

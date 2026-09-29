// Browser-only. Your "memory key" is your identity: 16 random characters
// (~79 bits). It never leaves your devices except as the secret the server hashes
// to find your private Walrus memory. Enter it on any device to continue.

export interface Profile {
  code: string;
  name: string;
}

const KEY = "studybuddy.profile.v2";
const OLD_KEY = "studybuddy.user.v1"; // earlier builds — migrated so nobody loses their memory
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)

export function generateKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return s.match(/.{4}/g)!.join("-");
}

export const normalizeKey = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
export const looksLikeKey = (k: string) => /^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$/.test(k);

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Profile>;
    if (typeof p.code === "string" && looksLikeKey(p.code)) return { code: p.code, name: (p.name ?? "Student").slice(0, 30) };
  } catch {
    /* ignore */
  }
  return null;
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearProfile(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(OLD_KEY);
}

export function downloadKeyFile(p: Profile): void {
  const text = `Study Buddy memory key for ${p.name}\n\n${p.code}\n\nKeep this private — anyone with it can read your Study Buddy memory.\nEnter it at the Study Buddy sign-in screen ("I have a memory key") on any device to continue where you left off.\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "study-buddy-memory-key.txt";
  a.click();
  URL.revokeObjectURL(url);
}

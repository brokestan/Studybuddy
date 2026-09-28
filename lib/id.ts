const STORAGE_KEY = "studybuddy.user.v1";

// Alphabet without look-alike characters (no 0/o, 1/l/i) so codes survive being
// read off one screen and typed on a phone.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export interface StudyBuddyUser {
  /** The portable "memory code". This is what becomes the MemWal namespace.
   *  Treat it like a password: whoever has it can read that memory folder,
   *  on any device, since MemWal isolates by namespace, not by device. */
  code: string;
  /** Display name only — never used for the namespace, so two different
   *  students can both be named "Sam" without colliding. */
  name: string;
}

/** 16 random characters from a 31-symbol alphabet ≈ 79 bits of entropy.
 *  This code unlocks private memory, so it must not be guessable. */
function randomCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

/** Keeps codes consistent no matter how a user types them back in. */
export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function loadUser(): StudyBuddyUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StudyBuddyUser;
  } catch {
    return null;
  }
}

/** Brand new student: generate a fresh code, remember it on this device too. */
export function startNewProfile(name: string): StudyBuddyUser {
  const user: StudyBuddyUser = { code: randomCode(), name: name.trim() || "Student" };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}

/** Returning student on a (possibly new) device: they type their existing code. */
export function restoreProfile(code: string, name: string): StudyBuddyUser {
  const user: StudyBuddyUser = {
    code: normalizeCode(code),
    name: name.trim() || "Student",
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}

/** Forgets the profile on *this device only*. The memory itself is untouched
 *  on Walrus — the same code will bring it right back. */
export function forgetProfile(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

// Deterministic output guard. Prompts alone are not a security boundary — an
// LLM can be talked into quoting things it was told to keep confidential.
// This runs in plain code AFTER the model answers and checks whether the reply
// reproduces a run of consecutive words from any private note.

export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export interface LeakResult {
  leaked: boolean;
  /** The private phrases that appeared in the reply (for logs/tests only). */
  matches: string[];
}

/**
 * @param n window size in words. A private note shorter than n words is
 *          checked as a whole, as long as it has at least 3 words.
 */
export function findLeaks(reply: string, privateTexts: string[], n = 5): LeakResult {
  const haystack = ` ${normalizeForMatch(reply)} `;
  const matches: string[] = [];

  for (const text of privateTexts) {
    const words = normalizeForMatch(text).split(" ").filter(Boolean);
    if (words.length < 3) continue;
    const size = Math.min(n, words.length);
    for (let i = 0; i + size <= words.length; i++) {
      const phrase = words.slice(i, i + size).join(" ");
      if (haystack.includes(` ${phrase} `)) {
        matches.push(phrase);
        break; // one hit per note is enough
      }
    }
  }
  return { leaked: matches.length > 0, matches };
}

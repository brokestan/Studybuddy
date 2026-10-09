// Turns Walrus's namespace listing into usage COUNTS for the dev-only Status page:
// "how many memory keys and how many study rooms have ever been used".
//
// Pure (no I/O, no Next.js imports) so it can be unit-tested.
//
// PRIVACY — read before changing: this function only ever returns NUMBERS.
// It must never return, log or display a namespace name, because:
//   - a private profile is `sb-u-<sha256 hash>`. The hash is one-way, so even
//     the full name cannot be turned back into the student's memory key; and
//   - a study room is `sb-r-<room code>`. The room code is NOT hashed (it is
//     the shared code people type to join), so a room's name IS its code.
// Counting is safe for both. Listing names would not be (rooms) or would be
// pointless and noisy (profiles). Counts only, always.
//
// `memory_count > 0` is what makes a namespace count as "used"; anything that
// merely exists with nothing stored in it is ignored.

export interface NamespaceInfo {
  name: string;
  memory_count: number;
}

export interface NamespaceSummary {
  /** Distinct private memory keys that have stored at least one memory (`sb-u-*`). */
  privateProfiles: number;
  /** Distinct study rooms that have stored at least one memory (`sb-r-*`). */
  studyRooms: number;
  /** Anything else on the account (the SDK default namespace, mock/test data...). */
  other: number;
  /** Memories stored across all private profiles / all study rooms. */
  privateMemories: number;
  roomMemories: number;
}

export function summarizeNamespaces(namespaces: NamespaceInfo[]): NamespaceSummary {
  const out: NamespaceSummary = { privateProfiles: 0, studyRooms: 0, other: 0, privateMemories: 0, roomMemories: 0 };
  const seen = new Set<string>(); // a namespace repeated across pages must not be double counted
  for (const n of namespaces) {
    const count = Number.isFinite(n.memory_count) ? n.memory_count : 0;
    if (count <= 0 || seen.has(n.name)) continue;
    seen.add(n.name);
    if (n.name.startsWith("sb-u-")) { out.privateProfiles++; out.privateMemories += count; }
    else if (n.name.startsWith("sb-r-")) { out.studyRooms++; out.roomMemories += count; }
    else out.other++;
  }
  return out;
}

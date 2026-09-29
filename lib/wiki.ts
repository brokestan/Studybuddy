// Wikipedia grounding: gives the tutor real, citable facts instead of relying on
// the model's memory alone. Free, no API key. Every failure path returns [] so
// the tutor simply answers without sources.
export interface Source {
  title: string;
  url: string;
  extract: string;
}

const BASE = () => process.env.WIKI_BASE ?? "https://en.wikipedia.org";
const UA = "StudyBuddy/1.0 (hackathon demo; https://github.com/brokestan/Studybuddy)";

const SKIP = /\b(quiz|flashcards?|study plan|schedule|my (progress|weak|notes|goals?|memory)|remind me|what do you know about me)\b/i;
const KNOWLEDGE = /\b(what|who|when|where|why|how|explain|define|meaning|difference|history|theorem|formula|law|cause|causes|process|works?)\b/i;

export function shouldGround(message: string): boolean {
  const m = message.trim();
  if (m.split(/\s+/).length < 3 || m.length > 400) return false;
  if (SKIP.test(m)) return false;
  return m.endsWith("?") || KNOWLEDGE.test(m);
}

export function parseSearch(json: unknown): string[] {
  const list = (json as { query?: { search?: { title?: unknown }[] } })?.query?.search;
  if (!Array.isArray(list)) return [];
  return list.map((r) => r?.title).filter((t): t is string => typeof t === "string").slice(0, 2);
}

export function parseSummary(json: unknown): Source | null {
  const j = json as { title?: unknown; extract?: unknown; content_urls?: { desktop?: { page?: unknown } } };
  if (typeof j?.title !== "string" || typeof j?.extract !== "string" || j.extract.length < 40) return null;
  const url = typeof j.content_urls?.desktop?.page === "string" ? j.content_urls.desktop.page : "";
  if (!url) return null;
  return { title: j.title, url, extract: j.extract.slice(0, 700) };
}

async function getJson(url: string, ms: number): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function groundOn(query: string, timeoutMs = 3000): Promise<Source[]> {
  try {
    const q = encodeURIComponent(query.replace(/[?!.]+$/g, "").slice(0, 200));
    const search = await getJson(
      `${BASE()}/w/api.php?action=query&list=search&srsearch=${q}&srlimit=2&format=json&origin=*`,
      timeoutMs
    );
    const titles = parseSearch(search);
    const sums = await Promise.all(
      titles.map((t) => getJson(`${BASE()}/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, "_"))}`, timeoutMs))
    );
    return sums.map(parseSummary).filter((s): s is Source => s !== null);
  } catch {
    return [];
  }
}

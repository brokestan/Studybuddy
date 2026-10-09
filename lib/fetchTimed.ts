// fetch() with two clocks:
//  - a SHORT one for "the server has not even started answering" (headers),
//    so one hung model costs ~25s instead of the whole 60s serverless budget
//    and the next fallback candidate still has time to run;
//  - a LONG one for the whole exchange, which still covers a streamed body.
// The short timer is cleared as soon as headers arrive, so a healthy stream
// that takes 40s to finish is never cut off by it.
export async function fetchTimed(url: string, init: RequestInit, headerMs = 25_000, totalMs = 55_000): Promise<Response> {
  const headerCtl = new AbortController();
  const timer = setTimeout(() => headerCtl.abort(new Error(`no response within ${Math.round(headerMs / 1000)}s`)), headerMs);
  try {
    return await fetch(url, { ...init, signal: AbortSignal.any([headerCtl.signal, AbortSignal.timeout(totalMs)]) });
  } finally {
    clearTimeout(timer);
  }
}

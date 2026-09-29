// Streaming helpers. parseSSEStream is adapted from the World Arena repo
// (lib/ai/stream.ts): TCP can deliver several SSE lines in one chunk or split
// one line across chunks, so we buffer by line.

export async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("data:")) yield t.slice(5).trim();
    }
  }
  if (buffer.trim().startsWith("data:")) yield buffer.trim().slice(5).trim();
}

const enc = new TextEncoder();
/** One JSON object per line — what the browser reads from /api/tutor. */
export const ndjson = (o: unknown): Uint8Array => enc.encode(JSON.stringify(o) + "\n");

/**
 * Removes <think>…</think> blocks from a token stream, even when the tags are
 * split across chunks. With reasoning_effort:"none" models shouldn't emit them,
 * but a retired/replaced model might, and users must never see raw reasoning.
 */
export class ThinkFilter {
  private buf = "";
  private inside = false;
  push(chunk: string): string {
    this.buf += chunk;
    let out = "";
    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf("</think>");
        if (end === -1) {
          this.buf = this.buf.slice(Math.max(0, this.buf.length - 8)); // keep a possible partial tag
          return out;
        }
        this.buf = this.buf.slice(end + 8);
        this.inside = false;
      } else {
        const start = this.buf.indexOf("<think>");
        if (start === -1) {
          // hold back a possible partial "<think>" at the tail
          const keep = partialTagLen(this.buf, "<think>");
          out += this.buf.slice(0, this.buf.length - keep);
          this.buf = this.buf.slice(this.buf.length - keep);
          return out;
        }
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + 7);
        this.inside = true;
      }
    }
  }
  flush(): string {
    const rest = this.inside ? "" : this.buf;
    this.buf = "";
    return rest;
  }
}

function partialTagLen(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

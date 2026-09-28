import { NextRequest, NextResponse } from "next/server";
import { getMemWal } from "@/lib/memwal";
import { privateNamespace, roomNamespace, normalizeCode, isValidCode, normalizeRoomId } from "@/lib/identity";

// Evidence generator for your article + bug report (adapted from the
// memory-test route in World Arena). Writes near-identical text into a private
// and a shared namespace, then checks that neither recall sees the other.
// Disabled unless ENABLE_DEV_TESTS=true. Delete before final submission if you like.
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_DEV_TESTS !== "true") {
    return NextResponse.json({ error: "Disabled. Set ENABLE_DEV_TESTS=true to enable." }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const code = normalizeCode(body.code ?? "");
  const roomId = normalizeRoomId(body.roomId ?? "isolation-test-room");
  if (!isValidCode(code)) return NextResponse.json({ error: "Invalid memory code." }, { status: 400 });

  const memwal = getMemWal();
  const priv = privateNamespace(code);
  const room = roomNamespace(roomId);
  const marker = "Isolation probe memory";
  const at = new Date().toISOString();

  try {
    const [pw, rw] = await Promise.all([
      memwal.rememberAndWait(`${marker} — the PRIVATE entry, written ${at}.`, priv),
      memwal.rememberAndWait(`${marker} — the SHARED entry, written ${at}.`, room),
    ]);
    const [pr, rr] = await Promise.all([
      memwal.recall({ query: marker, namespace: priv, limit: 10 }),
      memwal.recall({ query: marker, namespace: room, limit: 10 }),
    ]);
    const privSawShared = pr.results.some((r) => r.text.includes("SHARED entry"));
    const roomSawPrivate = rr.results.some((r) => r.text.includes("PRIVATE entry"));
    return NextResponse.json({
      pass: !privSawShared && !roomSawPrivate,
      privSawShared,
      roomSawPrivate,
      blobIds: { private: pw.blob_id, shared: rw.blob_id },
      note: "Each successful write here is a real mainnet blob — counts toward the 10-blob requirement.",
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

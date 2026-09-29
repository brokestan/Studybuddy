import { recallSafe, writeAndWait } from "@/lib/memory";
import { privateNamespace, roomNamespace } from "@/lib/identity";
import { ProofBody } from "@/lib/schemas";
import { limited, parse, json, fail, errMsg } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Evidence generator for your article + bug report. Writes near-identical text
// into a private and a shared namespace on Walrus, then checks neither recall
// sees the other. Off unless ENABLE_DEV_TESTS=true.
export async function POST(req: Request) {
  if (process.env.ENABLE_DEV_TESTS !== "true") return fail("Disabled. Set ENABLE_DEV_TESTS=true in Vercel to enable.", 404);
  const lim = limited(req, "proof", 4);
  if (lim) return lim;
  const p = await parse(req, ProofBody);
  if (!p.ok) return p.res;
  const priv = privateNamespace(p.data.code);
  const room = roomNamespace(p.data.roomId ?? "isolation-test-room");
  const marker = "Isolation probe memory";
  const at = new Date().toISOString();
  try {
    const [pw, rw] = await Promise.all([
      writeAndWait(priv, `${marker} — the PRIVATE entry, written ${at}.`),
      writeAndWait(room, `${marker} — the SHARED entry, written ${at}.`),
    ]);
    const [pr, rr] = await Promise.all([recallSafe(priv, marker, { limit: 10 }), recallSafe(room, marker, { limit: 10 })]);
    const privSawShared = pr.notes.some((n) => n.text.includes("SHARED entry"));
    const roomSawPrivate = rr.notes.some((n) => n.text.includes("PRIVATE entry"));
    return json({
      pass: !privSawShared && !roomSawPrivate,
      privSawShared,
      roomSawPrivate,
      blobIds: { private: pw.blob_id, shared: rw.blob_id },
      note: "Each successful write is a real mainnet blob and counts toward the 10-blob requirement.",
    });
  } catch (e) {
    return fail(errMsg(e), 500);
  }
}

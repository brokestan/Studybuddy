import { NextResponse } from "next/server";
import { getMemWal } from "@/lib/memwal";

export async function GET() {
  const status: Record<string, unknown> = {
    groqKeyPresent: Boolean(process.env.GROQ_API_KEY),
  };

  try {
    const memwal = getMemWal();
    const health = await memwal.health();
    status.memwal = health;
    status.memwalOk = true;
  } catch (err) {
    status.memwalOk = false;
    status.memwalError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(status);
}

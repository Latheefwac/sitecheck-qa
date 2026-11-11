import { connection, NextResponse } from "next/server";
import { db } from "@/lib/server/db";

// Public liveness check for Docker/Railway/Render. Reveals nothing beyond "up".
export async function GET() {
  await connection();
  try {
    db().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

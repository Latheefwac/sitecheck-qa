import { NextResponse } from "next/server";
import { updateScan } from "@/lib/server/db";
import { dequeue } from "@/lib/server/jobs";
import { cancelScan } from "@/lib/server/engine/runner";

export async function POST(_req: Request, ctx: RouteContext<"/api/scans/[id]/cancel">) {
  const { id } = await ctx.params;
  const wasQueued = dequeue(id);
  const wasRunning = cancelScan(id);
  if (wasQueued && !wasRunning) updateScan(id, { status: "cancelled", phase: "Cancelled" });
  return NextResponse.json({ ok: wasQueued || wasRunning });
}

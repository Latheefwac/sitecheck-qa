import { NextResponse } from "next/server";
import { getScan } from "@/lib/server/db";
import { enqueue } from "@/lib/server/jobs";

export async function POST(_req: Request, ctx: RouteContext<"/api/scans/[id]/rerun">) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["completed", "failed", "cancelled"].includes(scan.status)) return NextResponse.json({ error: `Scan is ${scan.status}` }, { status: 409 });
  enqueue({ kind: "rerun", scanId: id });
  return NextResponse.json({ ok: true });
}

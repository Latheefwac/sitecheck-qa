import { NextResponse } from "next/server";
import { deleteScan, getScan, listLinks, listLogs, listPages, listResults, listScreenshots } from "@/lib/server/db";
import { queuePosition, dequeue } from "@/lib/server/jobs";
import { cancelScan } from "@/lib/server/engine/runner";

export async function GET(_req: Request, ctx: RouteContext<"/api/scans/[id]">) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const links = listLinks(id);
  return NextResponse.json({
    scan,
    pages: listPages(id),
    results: listResults(id),
    screenshots: listScreenshots(id),
    logs: listLogs(id).slice(-300),
    linkStats: {
      internal: new Set(links.filter((l) => l.kind === "internal").map((l) => l.toUrl)).size,
      external: new Set(links.filter((l) => l.kind === "external").map((l) => l.toUrl)).size,
      broken: new Set(links.filter((l) => l.statusCode === null || (l.statusCode ?? 0) >= 400).map((l) => l.toUrl)).size,
      redirects: new Set(links.filter((l) => l.redirectedTo).map((l) => l.toUrl)).size,
    },
    queuePosition: queuePosition(id),
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/scans/[id]">) {
  const { id } = await ctx.params;
  dequeue(id);
  cancelScan(id);
  deleteScan(id);
  return NextResponse.json({ ok: true });
}

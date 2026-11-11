import { NextResponse } from "next/server";
import { z } from "zod";
import { getScan, setSelectedPages, upsertPage, listPages } from "@/lib/server/db";
import { enqueue } from "@/lib/server/jobs";
import { normalizeUrl, sameSite } from "@/lib/url";

const Body = z.object({ pageIds: z.array(z.number().int()).optional(), addUrls: z.array(z.string()).optional() });

export async function POST(req: Request, ctx: RouteContext<"/api/scans/[id]/start">) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["ready", "completed", "failed", "cancelled"].includes(scan.status)) return NextResponse.json({ error: `Scan is ${scan.status}` }, { status: 409 });
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  for (const raw of b.data.addUrls ?? []) {
    try {
      const u = normalizeUrl(raw, scan.url);
      if (!sameSite(u, scan.url)) continue;
      upsertPage(id, { url: u, statusCode: null, redirectTo: null, contentType: null, title: null, depth: 1, source: "manual", selected: true, isInternal: true, error: null });
    } catch {}
  }
  if (b.data.pageIds) {
    const added = listPages(id).filter((p) => p.source === "manual" && (b.data.addUrls ?? []).some((a) => { try { return normalizeUrl(a, scan.url) === p.url; } catch { return false; } })).map((p) => p.id);
    setSelectedPages(id, [...b.data.pageIds, ...added]);
  }
  if (!listPages(id).some((p) => p.selected)) return NextResponse.json({ error: "Select at least one page" }, { status: 400 });
  enqueue({ kind: "test", scanId: id });
  return NextResponse.json({ ok: true });
}

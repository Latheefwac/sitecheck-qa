import { NextResponse } from "next/server";
import { listResults, listWebsiteScans } from "@/lib/server/db";
import { resolveShareToken } from "@/lib/server/share";
import { toDevIssue } from "@/lib/server/share-view";
import { A11Y_LEVEL_INFO, levelOf } from "@/lib/a11y-levels";

export async function GET(req: Request, ctx: RouteContext<"/api/share/[token]">) {
  const { token } = await ctx.params;
  const link = resolveShareToken(token);
  if (!link) return NextResponse.json({ error: "This link is invalid, expired or has been revoked." }, { status: 404 });

  const scans = listWebsiteScans(link.websiteId).filter((s) => s.summary && s.status !== "running");
  const wanted = new URL(req.url).searchParams.get("scan");
  const scan = scans.find((s) => s.id === wanted) ?? scans[0] ?? null;
  const issues = scan
    ? listResults(scan.id).filter((r) => r.status === "FAIL" || r.status === "WARNING").map((r) => toDevIssue(r, token))
    : [];

  return NextResponse.json(
    {
      project: { origin: link.origin, developer: link.label, expiresAt: link.expiresAt },
      scans: scans.map((s) => ({ id: s.id, createdAt: s.createdAt, mode: s.mode, overall: s.scores?.overall ?? null, handoverStatus: s.scores?.handoverStatus ?? null })),
      scan: scan && { id: scan.id, url: scan.url, createdAt: scan.createdAt, mode: scan.mode, overall: scan.scores?.overall ?? null, handoverStatus: scan.scores?.handoverStatus ?? null, blockers: scan.scores?.blockers ?? [], a11yLevel: A11Y_LEVEL_INFO[levelOf(scan.options)].label },
      issues,
    },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } },
  );
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getResult, listActivity, updateResult } from "@/lib/server/db";
import { resolveShareToken, resultInProject } from "@/lib/server/share";
import { toDevIssue } from "@/lib/server/share-view";
import { BUG_STATUSES } from "@/lib/types";

// A share link may change ONLY the developer bug status and the developer note, and only on
// results that belong to its own project. QA fields (resolved, assignee, QA comment) are not writable here.
const Body = z.object({ bugStatus: z.enum(BUG_STATUSES).optional(), devComment: z.string().max(4000).nullable().optional() }).strict();

async function guard(ctx: RouteContext<"/api/share/[token]/results/[id]">) {
  const { token, id } = await ctx.params;
  const link = resolveShareToken(token);
  if (!link) return { error: NextResponse.json({ error: "This link is invalid, expired or has been revoked." }, { status: 404 }) };
  const result = resultInProject(Number(id), link.websiteId);
  if (!result) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { link, result, token };
}

export async function GET(_req: Request, ctx: RouteContext<"/api/share/[token]/results/[id]">) {
  const g = await guard(ctx);
  if (g.error) return g.error;
  return NextResponse.json({ issue: toDevIssue(g.result, g.token), activity: listActivity(g.result.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/share/[token]/results/[id]">) {
  const g = await guard(ctx);
  if (g.error) return g.error;
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Only the bug status and developer note can be changed." }, { status: 400 });
  updateResult(g.result.id, { bugStatus: b.data.bugStatus, devComment: b.data.devComment === undefined ? undefined : b.data.devComment?.trim() || null }, { name: g.link.label, via: "share" });
  return NextResponse.json({ issue: toDevIssue(getResult(g.result.id)!, g.token), activity: listActivity(g.result.id) });
}

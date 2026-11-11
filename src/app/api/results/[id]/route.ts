import { NextResponse } from "next/server";
import { z } from "zod";
import { getResult, listActivity, updateResult } from "@/lib/server/db";
import { rescore } from "@/lib/server/engine/runner";
import { BUG_STATUSES } from "@/lib/types";

const Body = z.object({
  resolved: z.boolean().optional(),
  assignee: z.string().max(120).nullable().optional(),
  comment: z.string().max(4000).nullable().optional(),
  bugStatus: z.enum(BUG_STATUSES).optional(),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/results/[id]">) {
  const { id } = await ctx.params;
  const r = getResult(Number(id));
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ result: r, activity: listActivity(r.id) });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/results/[id]">) {
  const { id } = await ctx.params;
  const r = getResult(Number(id));
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  updateResult(r.id, b.data, { name: "QA", via: "admin" });
  if (b.data.resolved !== undefined) rescore(r.scanId);
  return NextResponse.json(getResult(r.id));
}

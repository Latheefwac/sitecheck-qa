import { NextResponse } from "next/server";
import { z } from "zod";
import { getWebsite } from "@/lib/server/db";
import { createShareLink, listShareLinks } from "@/lib/server/share";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/links">) {
  const id = Number((await ctx.params).id);
  if (!getWebsite(id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(listShareLinks(id));
}

const Body = z.object({ label: z.string().trim().min(1).max(80), expiresInDays: z.number().int().min(1).max(365).nullable().optional() });

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/links">) {
  const id = Number((await ctx.params).id);
  if (!getWebsite(id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Enter the developer's name (max 80 characters)" }, { status: 400 });
  return NextResponse.json(createShareLink(id, b.data.label, b.data.expiresInDays ?? null), { status: 201 });
}

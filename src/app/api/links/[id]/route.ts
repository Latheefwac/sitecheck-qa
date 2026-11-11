import { NextResponse } from "next/server";
import { revokeShareLink } from "@/lib/server/share";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/links/[id]">) {
  revokeShareLink((await ctx.params).id);
  return NextResponse.json({ ok: true });
}

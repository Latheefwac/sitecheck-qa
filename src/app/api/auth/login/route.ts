import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminGateEnabled, adminSessionValue, safeEqual } from "@/lib/admin-auth";

export async function POST(req: Request) {
  if (!adminGateEnabled()) return NextResponse.json({ ok: true });
  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  const pw = typeof body.password === "string" ? body.password : "";
  // Small fixed delay blunts online guessing.
  await new Promise((r) => setTimeout(r, 400));
  if (!safeEqual(pw, process.env.QA_ADMIN_PASSWORD!)) return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminSessionValue()!, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14, secure: new URL(req.url).protocol === "https:",
  });
  return res;
}

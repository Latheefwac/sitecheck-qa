import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, adminGateEnabled, isAdminCookie } from "@/lib/admin-auth";

// Developer share links are public by design (the unguessable token is the credential) and are
// limited to one project by every /api/share route. Everything else is the admin area.
const PUBLIC = [/^\/share\//, /^\/api\/share\//, /^\/login$/, /^\/api\/auth\/login$/, /^\/api\/health$/];

export function proxy(req: NextRequest) {
  if (!adminGateEnabled()) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (isAdminCookie(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Admin sign-in required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

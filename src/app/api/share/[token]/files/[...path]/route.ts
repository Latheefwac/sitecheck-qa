import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/server/db";
import { resolveShareToken, scanInProject } from "@/lib/server/share";

// Screenshot evidence for a share link: only files under screenshots/<scanId>/ for scans in the link's project.
export async function GET(_req: Request, ctx: RouteContext<"/api/share/[token]/files/[...path]">) {
  const { token, path: parts } = await ctx.params;
  const link = resolveShareToken(token);
  if (!link || parts[0] !== "screenshots" || !parts[1] || !scanInProject(parts[1], link.websiteId)) return new Response("Not found", { status: 404 });
  const abs = path.resolve(DATA_DIR, ...parts);
  const root = path.resolve(DATA_DIR, "screenshots", parts[1]) + path.sep;
  if (!abs.startsWith(root) || !fs.existsSync(abs)) return new Response("Not found", { status: 404 });
  const type = abs.endsWith(".png") ? "image/png" : abs.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
  return new Response(new Uint8Array(fs.readFileSync(abs)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "Referrer-Policy": "no-referrer" } });
}

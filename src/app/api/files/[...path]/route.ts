import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/server/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const { path: parts } = await ctx.params;
  const abs = path.resolve(DATA_DIR, ...parts);
  const root = path.resolve(DATA_DIR, "screenshots") + path.sep;
  if (!abs.startsWith(root) || !fs.existsSync(abs)) return new Response("Not found", { status: 404 });
  const type = abs.endsWith(".png") ? "image/png" : abs.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
  return new Response(new Uint8Array(fs.readFileSync(abs)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
}

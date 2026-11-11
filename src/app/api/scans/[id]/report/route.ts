import { getScan } from "@/lib/server/db";
import { reportHtml, toCsv, toPdf, toXlsx } from "@/lib/server/reports";

export async function GET(req: Request, ctx: RouteContext<"/api/scans/[id]/report">) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return new Response("Not found", { status: 404 });
  const format = new URL(req.url).searchParams.get("format") ?? "pdf";
  const host = new URL(scan.url).hostname.replace(/[^a-z0-9.-]/gi, "");
  const date = (scan.finishedAt ?? scan.createdAt).slice(0, 10);
  const name = `qa-report-${host}-${date}`;
  if (format === "csv") return new Response(toCsv(id), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  if (format === "xlsx") return new Response(new Uint8Array(await toXlsx(id)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
  if (format === "html") return new Response(reportHtml(id), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new Response(new Uint8Array(await toPdf(id)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
}

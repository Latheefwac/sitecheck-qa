import { NextResponse } from "next/server";
import { getScan, listResults } from "@/lib/server/db";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const a = getScan(sp.get("a") ?? "");
  const b = getScan(sp.get("b") ?? "");
  if (!a || !b) return NextResponse.json({ error: "Both scans are required" }, { status: 400 });
  const key = (r: { checkKey: string; pageUrl: string; viewport?: string | null; browser?: string | null }) => `${r.checkKey}|${new URL(r.pageUrl).pathname}|${r.viewport ?? ""}|${r.browser ?? ""}`;
  const ra = new Map(listResults(a.id).map((r) => [key(r), r]));
  const rb = new Map(listResults(b.id).map((r) => [key(r), r]));
  const bad = (s?: string) => s === "FAIL" || s === "WARNING";
  const fixed = [], regressions = [], persisting = [];
  for (const [k, r] of rb) {
    const prev = ra.get(k);
    if (bad(r.status) && (!prev || !bad(prev.status))) regressions.push({ ...r, previous: prev?.status ?? null });
    else if (bad(r.status) && prev && bad(prev.status)) persisting.push(r);
  }
  for (const [k, r] of ra) if (bad(r.status) && (!rb.has(k) || !bad(rb.get(k)!.status))) fixed.push({ ...r, now: rb.get(k)?.status ?? null });
  return NextResponse.json({ a, b, fixed, regressions, persisting });
}

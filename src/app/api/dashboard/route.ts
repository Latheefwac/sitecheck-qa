import { connection, NextResponse } from "next/server";
import { db, listScans } from "@/lib/server/db";
import { SCORE_GROUPS } from "@/lib/types";

export async function GET() {
  await connection();
  const scans = listScans(500);
  const done = scans.filter((s) => s.status === "completed" && s.summary);
  // latest completed scan per website
  const latest = new Map<number, (typeof done)[number]>();
  for (const s of done) if (!latest.has(s.websiteId)) latest.set(s.websiteId, s);
  const lat = [...latest.values()];
  const sum = (f: (s: (typeof done)[number]) => number) => done.reduce((a, s) => a + f(s), 0);
  const avg = (vals: (number | null | undefined)[]) => {
    const v = vals.filter((x): x is number => typeof x === "number");
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const websites = (db().prepare("SELECT COUNT(*) c FROM websites").get() as { c: number }).c;
  const catTotals: Record<string, { pass: number; fail: number; warning: number; notTested: number }> = {};
  for (const s of lat) for (const [c, v] of Object.entries(s.summary!.byCategory)) {
    const t = (catTotals[c] ??= { pass: 0, fail: 0, warning: 0, notTested: 0 });
    t.pass += v.pass; t.fail += v.fail; t.warning += v.warning; t.notTested += v.notTested;
  }
  return NextResponse.json({
    totals: {
      websites,
      scans: scans.length,
      pages: sum((s) => s.summary!.pages),
      tests: sum((s) => s.summary!.total),
      passed: sum((s) => s.summary!.passed),
      failed: sum((s) => s.summary!.failed),
      warnings: sum((s) => s.summary!.warnings),
      critical: sum((s) => s.summary!.critical),
      overall: avg(lat.map((s) => s.scores?.overall)),
      readySites: lat.filter((s) => s.scores?.productionReady).length,
    },
    groups: Object.fromEntries(SCORE_GROUPS.map((g) => [g, avg(lat.map((s) => s.scores?.groups[g]))])),
    severity: ["Critical", "High", "Medium", "Low"].map((k) => ({ name: k, value: lat.reduce((a, s) => a + (s.summary!.bySeverity as Record<string, number>)[k], 0) })),
    categories: catTotals,
    trend: done.slice(0, 30).reverse().map((s) => ({ date: (s.finishedAt ?? s.createdAt).slice(0, 10), id: s.id, host: new URL(s.url).hostname, overall: s.scores?.overall ?? 0, performance: s.scores?.groups.performance, accessibility: s.scores?.groups.accessibility, seo: s.scores?.groups.seo })),
    recent: scans.slice(0, 10),
    sites: lat.map((s) => ({ id: s.id, url: s.url, overall: s.scores?.overall, performance: s.scores?.groups.performance, accessibility: s.scores?.groups.accessibility, seo: s.scores?.groups.seo, status: s.scores?.handoverStatus, date: s.finishedAt })),
  });
}

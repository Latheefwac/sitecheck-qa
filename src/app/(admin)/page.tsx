"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Radar } from "lucide-react";
import { CategoryStack, PassFailDonut, ScoreBars, SeverityBars, TrendLines } from "@/components/charts";
import { PageBody, PageHeader } from "@/components/page-header";
import { ScoreBar, ScoreRing, Stat } from "@/components/score";
import { HandoverBadge, ScanStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_LABELS, SCORE_GROUPS, SCORE_GROUP_LABELS, type Category, type Scan, type ScoreGroup } from "@/lib/types";
import { api, fmtDate, scoreColor } from "@/lib/utils";

interface Dash {
  totals: { websites: number; scans: number; pages: number; tests: number; passed: number; failed: number; warnings: number; critical: number; overall: number | null; readySites: number };
  groups: Record<ScoreGroup, number | null>;
  severity: { name: string; value: number }[];
  categories: Record<string, { pass: number; fail: number; warning: number; notTested: number }>;
  trend: { date: string; overall: number; performance?: number | null; accessibility?: number | null; seo?: number | null }[];
  recent: Scan[];
  sites: { id: string; url: string; overall?: number; performance?: number | null; accessibility?: number | null; seo?: number | null; status?: string; date?: string }[];
}

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api<Dash>("/api/dashboard").then(setD).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const t = d?.totals;
  const notTested = t ? t.tests - t.passed - t.failed - t.warnings : 0;
  return (
    <>
      <PageHeader title="Dashboard" description="Quality overview across every website tested (latest completed scan per site)." actions={<Button asChild><Link href="/scan"><Radar /> New scan</Link></Button>} />
      <PageBody>
        {err && <div className="rounded-md border border-fail/30 bg-fail/10 p-3 text-sm text-fail">{err}</div>}
        {d && d.totals.scans === 0 ? (
          <Card className="p-10 text-center">
            <Radar className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold">No scans yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter a website URL to crawl it and run functional, responsive, performance, SEO, accessibility and security tests.</p>
            <Button className="mt-5" asChild><Link href="/scan">Start your first scan <ArrowRight /></Link></Button>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Stat label="Websites tested" value={t?.websites ?? "—"} hint={`${t?.readySites ?? 0} ready for QA`} />
              <Stat label="Pages scanned" value={t?.pages ?? "—"} />
              <Stat label="Test cases run" value={t?.tests ?? "—"} hint={`${t?.scans ?? 0} scans`} />
              <Stat label="Passed" value={t?.passed ?? "—"} tone="pass" />
              <Stat label="Failed" value={t?.failed ?? "—"} tone="fail" />
              <Stat label="Warnings" value={t?.warnings ?? "—"} tone="warn" />
              <Stat label="Critical issues" value={t?.critical ?? "—"} tone="fail" />
              <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs">
                <ScoreRing value={t?.overall} size={56} label="Overall quality score" />
                <div className="text-xs text-muted-foreground">Overall quality</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader><CardTitle>Pass vs fail</CardTitle><CardDescription>All executed test cases</CardDescription></CardHeader>
                <CardContent>{t && <PassFailDonut passed={t.passed} failed={t.failed} warnings={t.warnings} notTested={notTested} />}</CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Category scores</CardTitle><CardDescription>Average of latest scan per site</CardDescription></CardHeader>
                <CardContent>{d && <ScoreBars data={SCORE_GROUPS.map((g) => ({ name: SCORE_GROUP_LABELS[g], value: d.groups[g] }))} />}</CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Issues by severity</CardTitle><CardDescription>Open failures and warnings</CardDescription></CardHeader>
                <CardContent>{d && <SeverityBars data={d.severity} />}</CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="lg:col-span-3">
                <CardHeader><CardTitle>Historical testing trends</CardTitle><CardDescription>Overall, performance, accessibility and SEO scores per completed scan</CardDescription></CardHeader>
                <CardContent>{d && <TrendLines data={d.trend} />}</CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Key scores</CardTitle><CardDescription>Performance, accessibility and SEO</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  {(["performance", "accessibility", "seo", "functionality", "responsive", "technical"] as ScoreGroup[]).map((g) => <ScoreBar key={g} label={SCORE_GROUP_LABELS[g]} value={d?.groups[g]} />)}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Testing status by category</CardTitle></CardHeader>
              <CardContent>{d && <CategoryStack data={Object.entries(d.categories).map(([k, v]) => ({ name: CATEGORY_LABELS[k as Category] ?? k, ...v }))} />}</CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Website performance overview</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Website</th><th className="pb-2 font-medium">Overall</th><th className="pb-2 font-medium">Perf</th><th className="pb-2 font-medium">A11y</th><th className="pb-2 font-medium">SEO</th><th className="pb-2 font-medium">Handover</th></tr></thead>
                    <tbody>
                      {d?.sites.map((s) => (
                        <tr key={s.id} className="border-t">
                          <td className="py-2 pr-3"><Link className="font-medium hover:underline" href={`/scans/${s.id}`}>{new URL(s.url).hostname}</Link></td>
                          {[s.overall, s.performance, s.accessibility, s.seo].map((v, i) => <td key={i} className={`py-2 tabular-nums ${scoreColor(v)}`}>{v ?? "—"}</td>)}
                          <td className="py-2"><HandoverBadge status={s.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex-row items-center justify-between"><CardTitle>Recent testing history</CardTitle><Link href="/scans" className="text-xs text-muted-foreground hover:text-foreground">View all</Link></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {d?.recent.map((s) => (
                        <tr key={s.id} className="border-t first:border-t-0">
                          <td className="py-2 pr-3"><Link className="font-medium hover:underline" href={`/scans/${s.id}`}>{new URL(s.url).hostname}</Link><div className="text-[11px] text-muted-foreground">{s.mode} · {fmtDate(s.createdAt)}</div></td>
                          <td className="py-2"><ScanStatusBadge status={s.status} /></td>
                          <td className={`py-2 text-right font-medium tabular-nums ${scoreColor(s.scores?.overall)}`}>{s.scores?.overall ?? (s.status === "running" ? `${Math.round(s.progress)}%` : "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

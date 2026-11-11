"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, FileText, GitCompare, Link2, Loader2, RotateCw, Square, Trash2 } from "lucide-react";
import { ShareDialog } from "@/components/share-dialog";
import { CategoryStack, PassFailDonut } from "@/components/charts";
import { PageBody, PageHeader } from "@/components/page-header";
import { PageSelection } from "@/components/scan/page-selection";
import { ResultsTable } from "@/components/scan/results-table";
import { Screenshots } from "@/components/scan/screenshots";
import type { ScanDetail } from "@/components/scan/types";
import { ScoreBar, ScoreRing, Stat } from "@/components/score";
import { HandoverBadge, ScanStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORY_LABELS, SCORE_GROUPS, SCORE_GROUP_LABELS, type Category, type TestResult } from "@/lib/types";
import { api, fmtDate } from "@/lib/utils";
import { A11Y_LEVEL_INFO, levelOf } from "@/lib/a11y-levels";
import { categoriesOf, categoriesText, isPartialScan, runsCategory, TESTABLE_CATEGORIES } from "@/lib/test-categories";

export function ScanView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<ScanDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<{ progress: number; phase: string; counts: Record<string, number> }>({ progress: 0, phase: "", counts: {} });
  const [busy, setBusy] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api<ScanDetail>(`/api/scans/${id}`).then((x) => { setD(x); setLive((l) => ({ ...l, progress: x.scan.progress, phase: x.scan.phase ?? "" })); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const active = d && ["discovering", "running", "queued"].includes(d.scan.status);
  useEffect(() => {
    if (!active) return;
    const es = new EventSource(`/api/scans/${id}/events`);
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (!t) t = setTimeout(() => { t = null; load(); }, 2500); };
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "progress") setLive((l) => ({ ...l, progress: e.progress, phase: e.phase }));
      if (e.type === "result") setLive((l) => ({ ...l, counts: { ...l.counts, [e.status]: (l.counts[e.status] ?? 0) + 1 } }));
      if (e.type === "log") refresh();
      if (e.type === "status") load();
    };
    const poll = setInterval(load, 8000);
    return () => { es.close(); clearInterval(poll); if (t) clearTimeout(t); };
  }, [active, id, load]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [d?.logs.length]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const updateResult = (r: TestResult) => { setD((x) => (x ? { ...x, results: x.results.map((y) => (y.id === r.id ? r : y)) } : x)); if ("resolved" in r) load(); };

  if (err && !d) return <PageBody><div className="mt-12 rounded-md border border-fail/30 bg-fail/10 p-4 text-sm text-fail">{err}</div></PageBody>;
  if (!d) return <PageBody><div className="mt-16 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading scan…</div></PageBody>;
  const { scan, results } = d;
  const s = scan.summary;
  const sc = scan.scores;
  const done = ["completed", "failed", "cancelled"].includes(scan.status) && results.length > 0;
  const openFails = results.filter((r) => r.status === "FAIL" && !r.resolved).length;

  return (
    <>
      <PageHeader
        title={new URL(scan.url).hostname}
        description={<span className="flex flex-wrap items-center gap-2"><a href={scan.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{scan.url}</a> · <span className="capitalize">{scan.mode} scan</span> · <span title={categoriesText(scan.options)}>{isPartialScan(scan.options) ? `${categoriesOf(scan.options).length} of ${TESTABLE_CATEGORIES.length} test categories` : "All test categories"}</span> · {runsCategory(scan.options, "accessibility") && <><span title={A11Y_LEVEL_INFO[levelOf(scan.options)].description}>Accessibility: {A11Y_LEVEL_INFO[levelOf(scan.options)].short}</span> · </>}{fmtDate(scan.createdAt)} <ScanStatusBadge status={scan.status} />{scan.hasAuth && <span className="text-xs">· authenticated</span>}</span>}
        actions={
          <>
            {active && <Button variant="outline" disabled={!!busy} onClick={() => act("cancel", () => api(`/api/scans/${id}/cancel`, { method: "POST" }))}><Square /> Stop</Button>}
            {done && openFails > 0 && <Button variant="outline" disabled={!!busy} onClick={() => act("rerun", () => api(`/api/scans/${id}/rerun`, { method: "POST" }))}>{busy === "rerun" ? <Loader2 className="animate-spin" /> : <RotateCw />} Re-run failed ({openFails})</Button>}
            {done && scan.baselineScanId && <Button variant="outline" asChild><Link href={`/compare?a=${scan.baselineScanId}&b=${scan.id}`}><GitCompare /> Compare</Link></Button>}
            {done && <Button variant="outline" onClick={() => setSharing(true)}><Link2 /> Share with developer</Button>}
            {done && (
              <>
                <Button variant="outline" asChild><a href={`/api/scans/${id}/report?format=pdf`}><FileText /> PDF</a></Button>
                <Button variant="outline" asChild><a href={`/api/scans/${id}/report?format=xlsx`}><FileSpreadsheet /> Excel</a></Button>
                <Button variant="outline" asChild><a href={`/api/scans/${id}/report?format=csv`}><Download /> CSV</a></Button>
              </>
            )}
            {!active && <Button variant="ghost" size="icon" aria-label="Delete scan" disabled={!!busy} onClick={() => confirm("Delete this scan and its screenshots? This cannot be undone.") && act("delete", async () => { await api(`/api/scans/${id}`, { method: "DELETE" }); router.push("/scans"); })}><Trash2 /></Button>}
          </>
        }
      />
      <PageBody>
        {err && <div role="alert" className="rounded-md border border-fail/30 bg-fail/10 p-3 text-sm text-fail">{err}</div>}
        {scan.status === "failed" && scan.error && <div role="alert" className="flex items-start gap-2 rounded-md border border-fail/30 bg-fail/10 p-3 text-sm text-fail"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {scan.error}</div>}

        {(active || scan.status === "ready") && (
          <Card>
            <CardHeader>
              <CardTitle>{scan.status === "ready" ? "Discovery complete" : scan.status === "queued" ? `Queued${d.queuePosition >= 0 ? ` (position ${d.queuePosition + 1})` : ""}` : scan.status === "discovering" ? "Crawling website" : "Running tests"}</CardTitle>
              <CardDescription aria-live="polite">{live.phase || scan.phase}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {scan.status !== "ready" && (
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={live.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Scan progress">
                  <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${live.progress}%` }} />
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {scan.status !== "ready" && <span className="tabular-nums">{Math.round(live.progress)}%</span>}
                <span>{d.pages.length} URL(s) found</span>
                <span>{d.linkStats.internal} internal / {d.linkStats.external} external links</span>
                <span className="text-fail">{d.linkStats.broken} broken</span>
                <span className="text-warn">{d.linkStats.redirects} redirects</span>
                {scan.status === "running" && <span><span className="text-pass">{live.counts.PASS ?? 0} pass</span> · <span className="text-fail">{live.counts.FAIL ?? 0} fail</span> · <span className="text-warn">{live.counts.WARNING ?? 0} warn</span></span>}
              </div>
              <div ref={logRef} className="max-h-48 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed">
                {d.logs.slice(-80).map((l) => <div key={l.id} className={l.level === "error" ? "text-fail" : l.level === "warn" ? "text-warn" : "text-muted-foreground"}>{l.ts.slice(11, 19)} {l.message}</div>)}
              </div>
            </CardContent>
          </Card>
        )}

        {scan.status === "ready" && <PageSelection scanId={scan.id} pages={d.pages} onStarted={load} />}

        {results.length > 0 && (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="issues">Issues ({results.filter((r) => !r.resolved && (r.status === "FAIL" || r.status === "WARNING")).length})</TabsTrigger>
              <TabsTrigger value="all">All tests ({results.length})</TabsTrigger>
              <TabsTrigger value="screens">Screenshots ({d.screenshots.length})</TabsTrigger>
              <TabsTrigger value="pages">Pages ({d.pages.filter((p) => p.selected).length})</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <ScoreRing value={sc?.overall} size={120} label="Overall quality score" />
                  <div className="text-xs text-muted-foreground">Overall quality score</div>
                  <HandoverBadge status={sc?.handoverStatus} />
                  {isPartialScan(scan.options) && <p className="text-xs text-warn">Partial scan: covers only {categoriesText(scan.options)}, plus crawl and links.</p>}
                  {sc?.blockers.length ? <ul className="mt-1 space-y-1 text-left text-xs text-fail">{sc.blockers.map((b) => <li key={b} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{b}</li>)}</ul> : null}
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader><CardTitle>Category scores</CardTitle><CardDescription>Weights are configurable in Settings · N/A = category not tested</CardDescription></CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">{SCORE_GROUPS.map((g) => <ScoreBar key={g} label={g === "accessibility" ? `${SCORE_GROUP_LABELS[g]} (${A11Y_LEVEL_INFO[levelOf(scan.options)].short})` : SCORE_GROUP_LABELS[g]} value={sc?.groups[g]} />)}</CardContent>
                </Card>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Pages tested" value={s?.pages ?? 0} />
                <Stat label="Test cases" value={s?.total ?? 0} />
                <Stat label="Passed" value={s?.passed ?? 0} tone="pass" />
                <Stat label="Failed" value={s?.failed ?? 0} tone="fail" />
                <Stat label="Warnings" value={s?.warnings ?? 0} tone="warn" />
                <Stat label="Critical" value={s?.critical ?? 0} tone="fail" hint={`${s?.notTested ?? 0} not tested`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-5">
                <Card className="lg:col-span-2"><CardHeader><CardTitle>Results</CardTitle></CardHeader><CardContent>{s && <PassFailDonut passed={s.passed} failed={s.failed} warnings={s.warnings} notTested={s.notTested} />}</CardContent></Card>
                <Card className="lg:col-span-3"><CardHeader><CardTitle>By category</CardTitle></CardHeader><CardContent>{s && <CategoryStack data={Object.entries(s.byCategory).map(([k, v]) => ({ name: CATEGORY_LABELS[k as Category] ?? k, ...v }))} />}</CardContent></Card>
              </div>
            </TabsContent>
            <TabsContent value="issues"><ResultsTable results={results} onChange={updateResult} initialStatus="OPEN" /></TabsContent>
            <TabsContent value="all"><ResultsTable results={results} onChange={updateResult} /></TabsContent>
            <TabsContent value="screens"><Screenshots shots={d.screenshots} /></TabsContent>
            <TabsContent value="pages">
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">URL</th><th className="px-3 py-2 font-medium">HTTP</th><th className="px-3 py-2 font-medium">Pass</th><th className="px-3 py-2 font-medium">Fail</th><th className="px-3 py-2 font-medium">Warn</th></tr></thead>
                  <tbody>
                    {d.pages.filter((p) => p.selected).map((p) => {
                      const pr = results.filter((r) => r.pageUrl === p.url);
                      return (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{p.url}<div className="font-sans text-[11px] text-muted-foreground">{p.title}</div></td>
                          <td className="px-3 py-2 tabular-nums">{p.statusCode ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums text-pass">{pr.filter((r) => r.status === "PASS" || r.resolved).length}</td>
                          <td className="px-3 py-2 tabular-nums text-fail">{pr.filter((r) => r.status === "FAIL" && !r.resolved).length}</td>
                          <td className="px-3 py-2 tabular-nums text-warn">{pr.filter((r) => r.status === "WARNING" && !r.resolved).length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </TabsContent>
            <TabsContent value="logs">
              <div className="max-h-[600px] overflow-auto rounded-lg border bg-muted p-3 font-mono text-[11px] leading-relaxed">
                {d.logs.map((l) => <div key={l.id} className={l.level === "error" ? "text-fail" : l.level === "warn" ? "text-warn" : ""}>{l.ts.replace("T", " ").slice(0, 19)} [{l.level}] {l.message}</div>)}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </PageBody>
      <ShareDialog websiteId={scan.websiteId} origin={new URL(scan.url).origin} open={sharing} onOpenChange={setSharing} />
    </>
  );
}

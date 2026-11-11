"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PageBody, PageHeader } from "@/components/page-header";
import { SeverityText, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { CATEGORY_LABELS, SCORE_GROUPS, SCORE_GROUP_LABELS, type Scan, type TestResult } from "@/lib/types";
import { api, cn, fmtDate, scoreColor } from "@/lib/utils";

interface Cmp { a: Scan; b: Scan; fixed: (TestResult & { now: string | null })[]; regressions: (TestResult & { previous: string | null })[]; persisting: TestResult[] }

export function CompareView() {
  const sp = useSearchParams();
  const router = useRouter();
  const [scans, setScans] = useState<Scan[]>([]);
  const [data, setData] = useState<Cmp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const a = sp.get("a") ?? "";
  const b = sp.get("b") ?? "";
  useEffect(() => { api<Scan[]>("/api/scans").then((s) => setScans(s.filter((x) => x.status === "completed"))); }, []);
  useEffect(() => {
    if (!a || !b) return;
    api<Cmp>(`/api/compare?a=${a}&b=${b}`).then(setData).catch((e) => setErr(e.message));
  }, [a, b]);
  const pick = (k: "a" | "b", v: string) => { const p = new URLSearchParams(sp.toString()); p.set(k, v); router.replace(`/compare?${p}`); };
  const label = (s: Scan) => `${new URL(s.url).hostname} · ${s.mode} · ${fmtDate(s.finishedAt ?? s.createdAt)} · ${s.scores?.overall ?? "—"}`;

  return (
    <>
      <PageHeader title="Compare reports" description="See what was fixed, what regressed and what is still open between two scans." />
      <PageBody>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <NativeSelect aria-label="Previous scan" className="flex-1" value={a} onChange={(e) => pick("a", e.target.value)}><option value="">Previous scan…</option>{scans.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</NativeSelect>
          <ArrowRight className="mx-auto size-4 shrink-0 text-muted-foreground" />
          <NativeSelect aria-label="Current scan" className="flex-1" value={b} onChange={(e) => pick("b", e.target.value)}><option value="">Current scan…</option>{scans.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</NativeSelect>
        </div>
        {err && <div className="rounded-md border border-fail/30 bg-fail/10 p-3 text-sm text-fail">{err}</div>}
        {(!data || !a || !b) && <p className="py-10 text-center text-sm text-muted-foreground">Choose two completed scans (ideally of the same website).</p>}
        {data && a && b && (
          <>
            <Card>
              <CardHeader><CardTitle>Score changes</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Category</th><th className="pb-2 font-medium">Previous</th><th className="pb-2 font-medium">Current</th><th className="pb-2 font-medium">Change</th></tr></thead>
                  <tbody>
                    {[["overall", "Overall"] as const, ...SCORE_GROUPS.map((g) => [g, SCORE_GROUP_LABELS[g]] as const)].map(([k, l]) => {
                      const pa = k === "overall" ? data.a.scores?.overall : data.a.scores?.groups[k];
                      const pb = k === "overall" ? data.b.scores?.overall : data.b.scores?.groups[k];
                      const delta = typeof pa === "number" && typeof pb === "number" ? pb - pa : null;
                      return (
                        <tr key={k} className={cn("border-t", k === "overall" && "font-semibold")}>
                          <td className="py-2">{l}</td><td className={`py-2 tabular-nums ${scoreColor(pa)}`}>{pa ?? "N/A"}</td><td className={`py-2 tabular-nums ${scoreColor(pb)}`}>{pb ?? "N/A"}</td>
                          <td className={cn("py-2 tabular-nums", delta === null ? "text-muted-foreground" : delta > 0 ? "text-pass" : delta < 0 ? "text-fail" : "text-muted-foreground")}>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <div className="grid gap-4 xl:grid-cols-3">
              <List title="Fixed" tone="text-pass" desc="Issues in the previous scan that now pass" items={data.fixed} />
              <List title="New / regressed" tone="text-fail" desc="Issues that did not exist before" items={data.regressions} />
              <List title="Still open" tone="text-warn" desc="Issues present in both scans" items={data.persisting} />
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

function List({ title, desc, items, tone }: { title: string; desc: string; items: TestResult[]; tone: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className={tone}>{title} ({items.length})</CardTitle><CardDescription>{desc}</CardDescription></CardHeader>
      <CardContent className="max-h-[520px] space-y-2 overflow-auto">
        {items.slice(0, 200).map((r) => (
          <div key={r.id} className="rounded-md border p-2.5">
            <div className="flex items-center gap-2"><StatusBadge status={r.status} /><SeverityText severity={r.severity} /><span className="text-[11px] text-muted-foreground">{CATEGORY_LABELS[r.category]}</span></div>
            <div className="mt-1 text-sm font-medium">{r.title}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{r.pageUrl}</div>
          </div>
        ))}
        {!items.length && <p className="text-sm text-muted-foreground">None</p>}
      </CardContent>
    </Card>
  );
}

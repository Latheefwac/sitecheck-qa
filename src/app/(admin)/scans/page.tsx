"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Radar, Search } from "lucide-react";
import { PageBody, PageHeader } from "@/components/page-header";
import { HandoverBadge, ScanStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import type { Scan } from "@/lib/types";
import { api, fmtDate, scoreColor } from "@/lib/utils";

export default function ScanHistory() {
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const load = () => api<Scan[]>("/api/scans").then(setScans).catch(() => setScans([]));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const rows = useMemo(() => (scans ?? []).filter((s) => (!q || s.url.toLowerCase().includes(q.toLowerCase())) && (!status || s.status === status)), [scans, q, status]);

  return (
    <>
      <PageHeader title="Scan history" description="Every scan with its status, scores and handover decision." actions={<Button asChild><Link href="/scan"><Radar /> New scan</Link></Button>} />
      <PageBody>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-60 flex-1 sm:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input aria-label="Search scans" placeholder="Search by URL" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["completed", "running", "discovering", "ready", "queued", "failed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
          </NativeSelect>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">Website</th><th className="px-4 py-2.5 font-medium">Mode</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Pages</th><th className="px-4 py-2.5 font-medium">Pass / Fail / Warn</th><th className="px-4 py-2.5 font-medium">Score</th><th className="px-4 py-2.5 font-medium">Handover</th><th className="px-4 py-2.5 font-medium">Date</th></tr>
            </thead>
            <tbody>
              {scans === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
              {scans && !rows.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No scans found.</td></tr>}
              {rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-2.5"><Link href={`/scans/${s.id}`} className="font-medium hover:underline">{s.url}</Link></td>
                  <td className="px-4 py-2.5 capitalize">{s.mode}</td>
                  <td className="px-4 py-2.5"><ScanStatusBadge status={s.status} />{["running", "discovering"].includes(s.status) && <span className="ml-2 text-xs text-muted-foreground tabular-nums">{Math.round(s.progress)}%</span>}</td>
                  <td className="px-4 py-2.5 tabular-nums">{s.summary?.pages ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{s.summary ? <><span className="text-pass">{s.summary.passed}</span> / <span className="text-fail">{s.summary.failed}</span> / <span className="text-warn">{s.summary.warnings}</span></> : "—"}</td>
                  <td className={`px-4 py-2.5 font-semibold tabular-nums ${scoreColor(s.scores?.overall)}`}>{s.scores?.overall ?? "—"}</td>
                  <td className="px-4 py-2.5">{s.scores ? <HandoverBadge status={s.scores.handoverStatus} /> : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}

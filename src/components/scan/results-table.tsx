"use client";
import { useMemo, useState } from "react";
import { Image as ImageIcon, MessageSquare, Search, UserRound } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/input";
import { BugStatusBadge, SeverityText, StatusBadge } from "@/components/ui/badge";
import { CATEGORY_LABELS, type Category, type TestResult } from "@/lib/types";
import { ResultDialog } from "./result-dialog";

const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const STATUS_ORDER = { FAIL: 0, WARNING: 1, NOT_TESTED: 2, PASS: 3 };

export function ResultsTable({ results, onChange, initialStatus = "" }: { results: TestResult[]; onChange: (r: TestResult) => void; initialStatus?: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState("");
  const [open, setOpen] = useState<TestResult | null>(null);
  const [limit, setLimit] = useState(200);

  const pages = useMemo(() => [...new Set(results.map((r) => r.pageUrl))].sort(), [results]);
  const cats = useMemo(() => [...new Set(results.map((r) => r.category))], [results]);
  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return results
      .filter((r) => {
        const st = r.resolved ? "RESOLVED" : r.status;
        return (!status || st === status || (status === "OPEN" && (st === "FAIL" || st === "WARNING"))) && (!severity || r.severity === severity) && (!category || r.category === category) && (!page || r.pageUrl === page) && (!ql || `${r.caseId} ${r.title} ${r.actual} ${r.pageUrl}`.toLowerCase().includes(ql));
      })
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.id - b.id);
  }, [results, q, status, severity, category, page]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search test cases" placeholder="Search ID, test, result…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="OPEN">Open issues</option><option value="FAIL">Fail</option><option value="WARNING">Warning</option><option value="PASS">Pass</option><option value="NOT_TESTED">Not tested</option><option value="RESOLVED">Resolved</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>{["Critical", "High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c as Category]}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filter by page" className="max-w-56" value={page} onChange={(e) => setPage(e.target.value)}>
          <option value="">All pages</option>{pages.map((p) => <option key={p} value={p}>{safePath(p)}</option>)}
        </NativeSelect>
      </div>
      <div className="text-xs text-muted-foreground">{rows.length} of {results.length} test case(s)</div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">ID</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Severity</th><th className="px-3 py-2 font-medium">Test</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 font-medium">Page</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.id} className="cursor-pointer border-b last:border-0 hover:bg-accent/50" onClick={() => setOpen(r)} onKeyDown={(e) => e.key === "Enter" && setOpen(r)} tabIndex={0}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">{r.caseId}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><StatusBadge status={r.status} resolved={r.resolved} />{!r.resolved && r.bugStatus !== "open" && <BugStatusBadge status={r.bugStatus} />}</div></td>
                <td className="px-3 py-2"><SeverityText severity={r.severity} /></td>
                <td className="px-3 py-2"><div className="font-medium">{r.title}</div><div className="line-clamp-1 max-w-xl text-xs text-muted-foreground">{r.actual}</div></td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{CATEGORY_LABELS[r.category]}</td>
                <td className="max-w-48 truncate px-3 py-2 font-mono text-[11px] text-muted-foreground" title={r.pageUrl}>{safePath(r.pageUrl)}</td>
                <td className="px-3 py-2"><div className="flex gap-1.5 text-muted-foreground">{r.screenshot && <ImageIcon className="size-3.5" aria-label="Has screenshot" />}{r.assignee && <UserRound className="size-3.5" aria-label={`Assigned to ${r.assignee}`} />}{(r.comment || r.devComment) && <MessageSquare className="size-3.5" aria-label="Has comment" />}</div></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No test cases match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button type="button" className="text-sm text-brand hover:underline cursor-pointer" onClick={() => setLimit(limit + 200)}>Show more ({rows.length - limit} remaining)</button>}
      <ResultDialog result={open} onClose={() => setOpen(null)} onSaved={(r) => { setOpen(r); onChange(r); }} />
    </div>
  );
}

function safePath(u: string) {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
}

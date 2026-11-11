import * as React from "react";
import { cn } from "@/lib/utils";
import type { Severity, TestStatus } from "@/lib/types";

export const Badge = ({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", className)} {...p} />;

const STATUS: Record<string, string> = {
  PASS: "bg-pass/10 text-pass border-pass/25",
  FAIL: "bg-fail/10 text-fail border-fail/25",
  WARNING: "bg-warn/10 text-warn border-warn/30",
  NOT_TESTED: "bg-muted text-muted-foreground",
  RESOLVED: "bg-info/10 text-info border-info/25",
};
export function StatusBadge({ status, resolved }: { status: TestStatus; resolved?: boolean }) {
  const s = resolved ? "RESOLVED" : status;
  return (
    <Badge className={STATUS[s]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {s === "NOT_TESTED" ? "NOT TESTED" : s}
    </Badge>
  );
}
const SEV: Record<Severity, string> = { Critical: "text-fail font-semibold", High: "text-fail/80", Medium: "text-warn", Low: "text-muted-foreground" };
export const SeverityText = ({ severity }: { severity: Severity }) => <span className={cn("text-xs", SEV[severity])}>{severity}</span>;

const SCAN: Record<string, string> = {
  completed: "bg-pass/10 text-pass border-pass/25",
  running: "bg-info/10 text-info border-info/25",
  discovering: "bg-info/10 text-info border-info/25",
  queued: "bg-muted text-muted-foreground",
  ready: "bg-brand/10 text-brand border-brand/25",
  failed: "bg-fail/10 text-fail border-fail/25",
  cancelled: "bg-muted text-muted-foreground",
};
export const ScanStatusBadge = ({ status }: { status: string }) => (
  <Badge className={SCAN[status]}>
    {["running", "discovering"].includes(status) && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
    {status === "ready" ? "awaiting start" : status}
  </Badge>
);

export function HandoverBadge({ status }: { status?: string | null }) {
  if (!status) return <Badge className="bg-muted text-muted-foreground">Not scored</Badge>;
  const c = status === "READY FOR QA" ? "bg-pass/10 text-pass border-pass/25" : status === "READY WITH WARNINGS" ? "bg-warn/10 text-warn border-warn/30" : "bg-fail/10 text-fail border-fail/25";
  return <Badge className={c}>{status}</Badge>;
}

const BUG: Record<string, string> = {
  open: "bg-muted text-foreground",
  in_progress: "bg-info/10 text-info border-info/25",
  fixed: "bg-pass/10 text-pass border-pass/25",
  needs_info: "bg-warn/10 text-warn border-warn/30",
  wont_fix: "bg-muted text-muted-foreground line-through decoration-1",
};
const BUG_SHORT: Record<string, string> = { open: "Open", in_progress: "In progress", fixed: "Fixed", needs_info: "Needs info", wont_fix: "Won't fix" };
export const BugStatusBadge = ({ status }: { status: string }) => <Badge className={BUG[status] ?? BUG.open}>{BUG_SHORT[status] ?? status}</Badge>;

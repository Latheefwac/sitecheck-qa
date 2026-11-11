"use client";
/* eslint-disable @next/next/no-img-element -- screenshots are private API files; next/image optimisation adds nothing here */
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { BugStatusBadge, SeverityText, StatusBadge } from "@/components/ui/badge";
import { BUG_STATUSES, BUG_STATUS_LABELS, CATEGORY_LABELS, type BugStatus, type TestResult } from "@/lib/types";
import { api, fileUrl, fmtDate } from "@/lib/utils";

export function ResultDialog({ result, onClose, onSaved }: { result: TestResult | null; onClose: () => void; onSaved: (r: TestResult) => void }) {
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{result && <Body key={result.id} r={result} onSaved={onSaved} />}</DialogContent>
    </Dialog>
  );
}

function Body({ r, onSaved }: { r: TestResult; onSaved: (r: TestResult) => void }) {
  const [assignee, setAssignee] = useState(r.assignee ?? "");
  const [comment, setComment] = useState(r.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [bugStatus, setBugStatus] = useState<BugStatus>(r.bugStatus);
  type Activity = { id: number; ts: string; actor: string; via: string; fromStatus: string | null; toStatus: string | null; note: string | null };
  const [activity, setActivity] = useState<Activity[]>([]);
  useEffect(() => {
    api<{ activity: Activity[] }>(`/api/results/${r.id}`).then((x) => setActivity(x.activity)).catch(() => {});
  }, [r.id, r.bugStatus, r.devComment]);
  const save = async (patch: Partial<Pick<TestResult, "resolved" | "assignee" | "comment" | "bugStatus">>) => {
    setBusy(true);
    try {
      onSaved(await api<TestResult>(`/api/results/${r.id}`, { method: "PATCH", body: JSON.stringify(patch) }));
    } finally {
      setBusy(false);
    }
  };
  const shot = fileUrl(r.screenshot);
  const field = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr]"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="min-w-0 text-sm">{value}</div></div>
  );
  return (
    <>
      <div className="pr-6">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-mono">{r.caseId}</span>·<StatusBadge status={r.status} resolved={r.resolved} /><SeverityText severity={r.severity} />·<span>{CATEGORY_LABELS[r.category]}</span></div>
        <DialogTitle>{r.title}</DialogTitle>
        <DialogDescription>{r.description}</DialogDescription>
      </div>
      <div className="space-y-3">
        {field("Page URL", <a href={r.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all hover:underline">{r.pageUrl}<ExternalLink className="size-3" /></a>)}
        {(r.viewport || r.browser) && field("Environment", [r.viewport, r.browser].filter(Boolean).join(" · "))}
        {field("Expected", r.expected)}
        {field("Actual", <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-xs">{r.actual}</pre>)}
        {r.error && field("Error", <pre className="whitespace-pre-wrap break-words rounded-md bg-fail/10 p-2.5 font-mono text-xs text-fail">{r.error}</pre>)}
        {r.recommendation && field("Recommended fix", <div className="rounded-md border border-brand/25 bg-brand/5 p-2.5">{r.recommendation}</div>)}
        {field("Executed", fmtDate(r.createdAt))}
        {r.devComment && field("Developer note", <div className="whitespace-pre-wrap rounded-md bg-muted p-2.5">{r.devComment}</div>)}
        {r.statusAt && field("Bug status", <span className="flex flex-wrap items-center gap-1.5"><BugStatusBadge status={r.bugStatus} /> <span className="text-xs text-muted-foreground">by {r.statusBy} · {fmtDate(r.statusAt)}</span></span>)}
        {shot && field("Evidence", <a href={shot} target="_blank" rel="noopener noreferrer"><img src={shot} alt={`Screenshot evidence for ${r.title}`} className="max-h-96 rounded-md border object-contain object-top" /></a>)}
      </div>
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bug-status">Bug status</Label>
          <NativeSelect id="bug-status" className="w-full" value={bugStatus} onChange={(e) => setBugStatus(e.target.value as BugStatus)}>
            {BUG_STATUSES.map((s) => <option key={s} value={s}>{BUG_STATUS_LABELS[s]}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5"><Label htmlFor="assignee">Assign to developer</Label><Input id="assignee" placeholder="Name or email" value={assignee} onChange={(e) => setAssignee(e.target.value)} /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="comment">Comment</Label><Textarea id="comment" rows={3} placeholder="Notes for the team…" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button disabled={busy} onClick={() => save({ assignee: assignee || null, comment: comment || null, bugStatus })}>{busy && <Loader2 className="animate-spin" />} Save</Button>
          {r.status !== "PASS" && r.status !== "NOT_TESTED" && (r.resolved ? <Button variant="outline" disabled={busy} onClick={() => save({ resolved: false })}><RotateCcw /> Reopen</Button> : <Button variant="outline" disabled={busy} onClick={() => save({ resolved: true })}><CheckCircle2 /> Mark as resolved</Button>)}
        </div>
      </div>
      {activity.length > 0 && (
        <div className="border-t pt-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Bug history</div>
          <ul className="space-y-1.5 text-xs">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">{fmtDate(a.ts)}</span><span className="font-medium">{a.actor}</span><span className="text-muted-foreground">({a.via === "share" ? "developer link" : "QA"})</span>
                {a.fromStatus !== a.toStatus ? <>changed <BugStatusBadge status={a.fromStatus ?? "open"} /> → <BugStatusBadge status={a.toStatus ?? "open"} /></> : <>added a note</>}
                {a.note && <span className="basis-full whitespace-pre-wrap pl-1 text-muted-foreground">“{a.note}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

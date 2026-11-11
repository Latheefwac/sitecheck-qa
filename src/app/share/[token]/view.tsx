"use client";
/* eslint-disable @next/next/no-img-element -- evidence screenshots are served by the token-scoped share API */
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { AlertTriangle, ExternalLink, Loader2, Lock, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import type { DevIssue } from "@/lib/server/share-view";
import { BUG_STATUSES, BUG_STATUS_LABELS, CATEGORY_LABELS, type BugStatus, type Category } from "@/lib/types";
import { api, fmtDate } from "@/lib/utils";
import { BugStatusBadge, HandoverBadge, SeverityText, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { ScoreRing } from "@/components/score";

interface ShareData {
  project: { origin: string; developer: string; expiresAt: string | null };
  scans: { id: string; createdAt: string; mode: string; overall: number | null; handoverStatus: string | null }[];
  scan: { id: string; url: string; createdAt: string; mode: string; overall: number | null; handoverStatus: string | null; blockers: string[]; a11yLevel: string } | null;
  issues: DevIssue[];
}
type Activity = { id: number; ts: string; actor: string; via: string; fromStatus: string | null; toStatus: string | null; note: string | null };

const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export function DevShareView() {
  const { token } = useParams<{ token: string }>();
  const [scanId, setScanId] = useState("");
  const [d, setD] = useState<ShareData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [bug, setBug] = useState("active");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<DevIssue | null>(null);

  const load = useCallback(
    () => api<ShareData>(`/api/share/${token}${scanId ? `?scan=${encodeURIComponent(scanId)}` : ""}`).then((x) => { setD(x); setErr(null); }).catch((e) => setErr((e as Error).message)),
    [token, scanId],
  );
  useEffect(() => { load(); }, [load]);

  const issues = useMemo(() => d?.issues ?? [], [d]);
  const cats = useMemo(() => [...new Set(issues.map((i) => i.category))], [issues]);
  const counts = useMemo(() => Object.fromEntries(BUG_STATUSES.map((s) => [s, issues.filter((i) => i.bugStatus === s && !i.resolved).length])) as Record<BugStatus, number>, [issues]);
  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    const me = d?.project.developer.toLowerCase();
    return issues
      .filter((i) =>
        (bug === "" || (bug === "active" ? !i.resolved && i.bugStatus !== "wont_fix" : bug === "resolved" ? i.resolved : !i.resolved && i.bugStatus === bug)) &&
        (!severity || i.severity === severity) && (!category || i.category === category) &&
        (!mine || (!!i.assignee && i.assignee.toLowerCase() === me)) &&
        (!ql || `${i.caseId} ${i.title} ${i.actual} ${i.pageUrl}`.toLowerCase().includes(ql)))
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.status === "FAIL" ? 0 : 1) - (b.status === "FAIL" ? 0 : 1) || a.id - b.id);
  }, [issues, q, bug, severity, category, mine, d]);

  if (err && !d) {
    return (
      <Centered>
        <Lock className="size-6 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Link unavailable</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{err} Ask your QA contact for a new link.</p>
      </Centered>
    );
  }
  if (!d) return <Centered><Loader2 className="size-5 animate-spin text-muted-foreground" /></Centered>;

  const host = new URL(d.project.origin).host;
  const onSaved = (i: DevIssue) => { setOpen(i); setD((x) => (x ? { ...x, issues: x.issues.map((y) => (y.id === i.id ? i : y)) } : x)); };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-sidebar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"><ShieldCheck className="size-4" /></div>
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold">Sitecheck QA</div>
              <div className="truncate text-[11px] text-muted-foreground">Developer view · shared with {d.project.developer}</div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{host}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Issues found by automated QA. Update the status as you work; QA confirms fixes with a re-test.
              {d.scan && <> Accessibility tested against <span className="font-medium text-foreground">{d.scan.a11yLevel}</span>.</>}
              {d.project.expiresAt && <> Link expires {fmtDate(d.project.expiresAt)}.</>}
            </p>
          </div>
          {d.scans.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="scan">Scan</Label>
              <NativeSelect id="scan" value={d.scan?.id ?? ""} onChange={(e) => setScanId(e.target.value)}>
                {d.scans.map((s, i) => <option key={s.id} value={s.id}>{fmtDate(s.createdAt)} · {s.mode}{i === 0 ? " (latest)" : ""}</option>)}
              </NativeSelect>
            </div>
          )}
        </div>

        {!d.scan ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">No completed scans for this project yet.</Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <Card className="flex items-center gap-4 p-4">
                <ScoreRing value={d.scan.overall} size={64} label="Overall quality score" />
                <div className="space-y-1.5"><div className="text-xs text-muted-foreground">Overall score</div><HandoverBadge status={d.scan.handoverStatus} /></div>
              </Card>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {BUG_STATUSES.map((s) => (
                  <button key={s} type="button" onClick={() => setBug(bug === s ? "active" : s)} aria-pressed={bug === s}
                    className={`rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent cursor-pointer ${bug === s ? "ring-2 ring-ring" : ""}`}>
                    <div className="text-[11px] text-muted-foreground">{BUG_STATUS_LABELS[s].replace(" – ready for retest", "")}</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums">{counts[s]}</div>
                  </button>
                ))}
              </div>
            </div>
            {d.scan.blockers.length > 0 && (
              <div className="rounded-lg border border-fail/30 bg-fail/5 p-3 text-xs text-fail">
                <div className="mb-1 font-medium">Blocking handover</div>
                <ul className="space-y-0.5">{d.scan.blockers.map((b) => <li key={b} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{b}</li>)}</ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input aria-label="Search issues" placeholder="Search ID, issue, page…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <NativeSelect aria-label="Filter by bug status" value={bug} onChange={(e) => setBug(e.target.value)}>
                <option value="active">Active (not resolved)</option>
                {BUG_STATUSES.map((s) => <option key={s} value={s}>{BUG_STATUS_LABELS[s]}</option>)}
                <option value="resolved">Resolved by QA</option>
                <option value="">All</option>
              </NativeSelect>
              <NativeSelect aria-label="Filter by severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="">All severities</option>{["Critical", "High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}
              </NativeSelect>
              <NativeSelect aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c as Category]}</option>)}
              </NativeSelect>
              <label className="flex items-center gap-2 rounded-md border px-3 text-sm">
                <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[var(--brand)]" /> Assigned to me
              </label>
            </div>

            <div className="text-xs text-muted-foreground">{rows.length} of {issues.length} issue(s)</div>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">ID</th><th className="px-3 py-2 font-medium">Severity</th><th className="px-3 py-2 font-medium">Issue</th><th className="px-3 py-2 font-medium">Page</th><th className="px-3 py-2 font-medium">Bug status</th></tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id} tabIndex={0} onClick={() => setOpen(i)} onKeyDown={(e) => e.key === "Enter" && setOpen(i)} className="cursor-pointer border-b last:border-0 hover:bg-accent/50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">{i.caseId}</td>
                      <td className="px-3 py-2"><SeverityText severity={i.severity} /></td>
                      <td className="px-3 py-2"><div className="font-medium">{i.title}</div><div className="line-clamp-1 max-w-xl text-xs text-muted-foreground">{CATEGORY_LABELS[i.category]} · {i.actual}</div></td>
                      <td className="max-w-48 truncate px-3 py-2 font-mono text-[11px] text-muted-foreground" title={i.pageUrl}>{pathOf(i.pageUrl)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{i.resolved ? <StatusBadge status={i.status} resolved /> : <BugStatusBadge status={i.bugStatus} />}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">No issues match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>{open && <IssueBody key={open.id} token={token} issue={open} onSaved={onSaved} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function IssueBody({ token, issue: i, onSaved }: { token: string; issue: DevIssue; onSaved: (i: DevIssue) => void }) {
  const [status, setStatus] = useState<BugStatus>(i.bugStatus);
  const [note, setNote] = useState(i.devComment ?? "");
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api<{ activity: Activity[] }>(`/api/share/${token}/results/${i.id}`).then((x) => setActivity(x.activity)).catch(() => setActivity([]));
  }, [token, i.id]);
  const dirty = status !== i.bugStatus || (note.trim() || null) !== (i.devComment ?? null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const x = await api<{ issue: DevIssue; activity: Activity[] }>(`/api/share/${token}/results/${i.id}`, { method: "PATCH", body: JSON.stringify({ bugStatus: status, devComment: note.trim() || null }) });
      setActivity(x.activity);
      onSaved(x.issue);
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const field = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr]"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="min-w-0 text-sm">{value}</div></div>
  );
  return (
    <>
      <div className="pr-6">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-mono">{i.caseId}</span>·<StatusBadge status={i.status} resolved={i.resolved} /><SeverityText severity={i.severity} />·<span>{CATEGORY_LABELS[i.category]}</span></div>
        <DialogTitle>{i.title}</DialogTitle>
        <DialogDescription>{i.description}</DialogDescription>
      </div>
      <div className="space-y-3">
        {field("Page URL", <a href={i.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all hover:underline">{i.pageUrl}<ExternalLink className="size-3" /></a>)}
        {(i.viewport || i.browser) && field("Environment", [i.viewport, i.browser].filter(Boolean).join(" · "))}
        {field("Expected", i.expected)}
        {field("Actual", <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-xs">{i.actual}</pre>)}
        {i.error && field("Error", <pre className="whitespace-pre-wrap break-words rounded-md bg-fail/10 p-2.5 font-mono text-xs text-fail">{i.error}</pre>)}
        {i.recommendation && field("Recommended fix", <div className="rounded-md border border-brand/25 bg-brand/5 p-2.5">{i.recommendation}</div>)}
        {i.assignee && field("Assigned to", i.assignee)}
        {i.qaComment && field("QA note", <div className="whitespace-pre-wrap">{i.qaComment}</div>)}
        {i.screenshot && field("Evidence", <a href={i.screenshot} target="_blank" rel="noopener noreferrer"><img src={i.screenshot} alt={`Screenshot evidence for ${i.title}`} className="max-h-96 rounded-md border object-contain object-top" /></a>)}
      </div>

      <div className="space-y-3 border-t pt-4">
        {i.resolved ? (
          <div className="rounded-md border border-info/25 bg-info/5 p-3 text-sm">QA has verified and resolved this issue.</div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="bug-status">Bug status</Label>
                <NativeSelect id="bug-status" className="w-full" value={status} onChange={(e) => setStatus(e.target.value as BugStatus)}>
                  {BUG_STATUSES.map((s) => <option key={s} value={s}>{BUG_STATUS_LABELS[s]}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-note">Developer note</Label>
                <Textarea id="dev-note" rows={2} maxLength={4000} placeholder="What changed, commit/PR link, or what you need from QA" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="animate-spin" />} Save update</Button>
              {msg && <span role="status" className={`text-xs ${msg.ok ? "text-pass" : "text-fail"}`}>{msg.text}</span>}
              {i.statusAt && <span className="text-xs text-muted-foreground">Last changed by {i.statusBy} · {fmtDate(i.statusAt)}</span>}
            </div>
          </>
        )}
        {activity && activity.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">History</div>
            <ul className="space-y-1.5 text-xs">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">{fmtDate(a.ts)}</span><span className="font-medium">{a.actor}</span>
                  {a.fromStatus !== a.toStatus ? <>changed <BugStatusBadge status={a.fromStatus ?? "open"} /> → <BugStatusBadge status={a.toStatus ?? "open"} /></> : <>added a note</>}
                  {a.note && <span className="basis-full whitespace-pre-wrap pl-1 text-muted-foreground">“{a.note}”</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>;
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden dark:block" /><Moon className="dark:hidden" />
    </Button>
  );
}

function pathOf(u: string) {
  try { const x = new URL(u); return x.pathname + x.search; } catch { return u; }
}

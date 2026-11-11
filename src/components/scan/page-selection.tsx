"use client";
import { useMemo, useState } from "react";
import { Loader2, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { PageRecord } from "@/lib/types";
import { api } from "@/lib/utils";

export function PageSelection({ scanId, pages, onStarted }: { scanId: string; pages: PageRecord[]; onStarted: () => void }) {
  const [sel, setSel] = useState<Set<number>>(() => new Set(pages.filter((p) => p.selected).map((p) => p.id)));
  const [filter, setFilter] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = useMemo(() => pages.filter((p) => !filter || p.url.toLowerCase().includes(filter.toLowerCase())), [pages, filter]);
  const testable = (p: PageRecord) => !!p.statusCode && p.statusCode < 400 && (p.contentType ?? "").includes("html");
  const allShownSelected = shown.length > 0 && shown.every((p) => sel.has(p.id));

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/scans/${scanId}/start`, { method: "POST", body: JSON.stringify({ pageIds: [...sel], addUrls: extra }) });
      onStarted();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle>Select pages to test</CardTitle>
          <CardDescription>{pages.length} URL(s) discovered · {sel.size + extra.length} selected. Pages with errors or non-HTML content are unselected by default.</CardDescription>
        </div>
        <Button variant="brand" onClick={start} disabled={busy || sel.size + extra.length === 0}>{busy ? <Loader2 className="animate-spin" /> : <Play />} Start testing</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {err && <div role="alert" className="rounded-md border border-fail/30 bg-fail/10 p-2 text-sm text-fail">{err}</div>}
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Filter pages" placeholder="Filter URLs…" className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (add.trim()) { setExtra([...extra, add.trim()]); setAdd(""); } }}>
            <Input aria-label="Add a page manually" placeholder="Add URL manually, e.g. /landing/offer" value={add} onChange={(e) => setAdd(e.target.value)} />
            <Button type="submit" variant="outline"><Plus /> Add</Button>
          </form>
        </div>
        {extra.length > 0 && <div className="flex flex-wrap gap-1.5">{extra.map((x) => <Badge key={x} className="bg-brand/10 text-brand">{x} <button type="button" aria-label={`Remove ${x}`} className="cursor-pointer" onClick={() => setExtra(extra.filter((e) => e !== x))}>×</button></Badge>)}</div>}
        <div className="max-h-[480px] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2"><Checkbox aria-label="Select all shown" checked={allShownSelected} onCheckedChange={(c) => { const n = new Set(sel); shown.forEach((p) => (c ? n.add(p.id) : n.delete(p.id))); setSel(n); }} /></th>
                <th className="px-3 py-2 font-medium">URL</th><th className="px-3 py-2 font-medium">HTTP</th><th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 font-medium">Title</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-3 py-1.5"><Checkbox aria-label={`Select ${p.url}`} checked={sel.has(p.id)} onCheckedChange={(c) => { const n = new Set(sel); if (c) n.add(p.id); else n.delete(p.id); setSel(n); }} /></td>
                  <td className="max-w-md truncate px-3 py-1.5 font-mono text-xs" title={p.url}>{p.url}{p.redirectTo && <span className="block text-[10px] text-warn">→ {p.redirectTo}</span>}</td>
                  <td className={`px-3 py-1.5 tabular-nums ${!p.statusCode || p.statusCode >= 400 ? "text-fail" : p.redirectTo ? "text-warn" : "text-pass"}`}>{p.statusCode ?? (p.error ? "ERR" : "—")}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.source}{p.statusCode && p.statusCode < 400 && !testable(p) && " · not HTML"}</td>
                  <td className="max-w-xs truncate px-3 py-1.5 text-xs text-muted-foreground">{p.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

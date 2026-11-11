"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import type { ShareLink } from "@/lib/types";
import { api, fmtDate } from "@/lib/utils";

export function ShareDialog({ websiteId, origin, open, onOpenChange }: { websiteId: number; origin: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">{open && <Body websiteId={websiteId} origin={origin} />}</DialogContent>
    </Dialog>
  );
}

function Body({ websiteId, origin }: { websiteId: number; origin: string }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [gate, setGate] = useState(true);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => api<ShareLink[]>(`/api/projects/${websiteId}/links`).then(setLinks).catch((e) => setErr((e as Error).message)), [websiteId]);
  useEffect(() => {
    load();
    api<{ gate: boolean }>("/api/auth/status").then((x) => setGate(x.gate)).catch(() => {});
  }, [load]);

  const fullUrl = (l: ShareLink) => `${window.location.origin}${l.path}`;
  const copy = async (l: ShareLink) => {
    await navigator.clipboard.writeText(fullUrl(l));
    setCopied(l.id);
    setTimeout(() => setCopied((c) => (c === l.id ? null : c)), 1500);
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const l = await api<ShareLink>(`/api/projects/${websiteId}/links`, { method: "POST", body: JSON.stringify({ label, expiresInDays: days ? Number(days) : null }) });
      setLabel("");
      await load();
      await copy(l).catch(() => {});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (l: ShareLink) => {
    if (!confirm(`Revoke the link for ${l.label}? It stops working immediately.`)) return;
    await api(`/api/links/${l.id}`, { method: "DELETE" }).catch((e) => setErr((e as Error).message));
    load();
  };
  const state = (l: ShareLink) => (l.revokedAt ? "revoked" : l.expiresAt && new Date(l.expiresAt) <= new Date() ? "expired" : "active");

  return (
    <>
      <div className="pr-6">
        <DialogTitle className="flex items-center gap-2"><Link2 className="size-4" /> Share with a developer</DialogTitle>
        <DialogDescription>
          Each link opens the issues for <span className="font-medium text-foreground">{new URL(origin).host}</span> only. Developers can change the bug status and add a note. They can&apos;t see other projects, run scans, resolve issues or change settings.
        </DialogDescription>
      </div>
      {!gate && (
        <div className="flex gap-2 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>The admin area has no password, so anyone who can reach this server can open every project. Set <code className="font-mono">QA_ADMIN_PASSWORD</code> and restart before sharing links outside your machine.</span>
        </div>
      )}
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
        <div className="space-y-1.5"><Label htmlFor="dev-name">Developer name or email</Label><Input id="dev-name" required maxLength={80} placeholder="e.g. Priya (frontend)" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="expiry">Expires</Label>
          <NativeSelect id="expiry" className="w-full" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="">Never</option>
          </NativeSelect>
        </div>
        <Button type="submit" disabled={busy || !label.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Link2 />} Create link</Button>
      </form>
      {err && <div role="alert" className="text-xs text-fail">{err}</div>}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Links for this project</div>
        {links === null && <div className="text-sm text-muted-foreground">Loading…</div>}
        {links?.length === 0 && <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No links yet.</div>}
        {links?.map((l) => {
          const st = state(l);
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">{l.label}
                  <Badge className={st === "active" ? "bg-pass/10 text-pass border-pass/25" : "bg-muted text-muted-foreground"}>{st}</Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Created {fmtDate(l.createdAt)} · {l.expiresAt ? `${st === "expired" ? "expired" : "expires"} ${fmtDate(l.expiresAt)}` : "no expiry"} · {l.lastUsedAt ? `last opened ${fmtDate(l.lastUsedAt)}` : "not opened yet"}
                </div>
              </div>
              {st === "active" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => copy(l)}>{copied === l.id ? <Check /> : <Copy />} {copied === l.id ? "Copied" : "Copy link"}</Button>
                  <Button size="icon" variant="ghost" aria-label={`Revoke link for ${l.label}`} onClick={() => revoke(l)}><Trash2 /></Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

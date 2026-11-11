"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/utils";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: pw }) });
      // Only same-site relative paths, never an absolute or protocol-relative URL.
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card className="w-full max-w-sm p-6">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><ShieldCheck className="size-4" /></div>
          <div><h1 className="text-base font-semibold">Sitecheck QA</h1><p className="text-xs text-muted-foreground">Admin sign-in</p></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="pw">Admin password</Label><Input id="pw" type="password" autoComplete="current-password" required autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        {err && <div role="alert" className="text-xs text-fail">{err}</div>}
        <Button type="submit" className="w-full" disabled={busy || !pw}>{busy && <Loader2 className="animate-spin" />} Sign in</Button>
        <p className="text-[11px] text-muted-foreground">Developers: use the project link your QA contact sent you. You don&apos;t need this page.</p>
      </form>
    </Card>
  );
}

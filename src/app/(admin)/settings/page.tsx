"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label } from "@/components/ui/input";
import { SCORE_GROUPS, SCORE_GROUP_LABELS, type Settings } from "@/lib/types";
import { api } from "@/lib/utils";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { api<Settings>("/api/settings").then(setS); }, []);
  if (!s) return <PageBody><div className="mt-16 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div></PageBody>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const totalW = SCORE_GROUPS.reduce((a, g) => a + (s.weights[g] || 0), 0);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try { setS(await api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) })); setMsg({ ok: true, text: "Settings saved. New values apply to the next scan; scores are recalculated when results change." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const num = (k: keyof Settings, label: string, hint?: string) => (
    <div className="space-y-1.5"><Label htmlFor={k}>{label}</Label><Input id={k} type="number" value={s[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>
  );
  const text = (k: keyof Settings, label: string, placeholder?: string, hint?: string) => (
    <div className="space-y-1.5"><Label htmlFor={k}>{label}</Label><Input id={k} placeholder={placeholder} value={s[k] as string} onChange={(e) => set(k, e.target.value as never)} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>
  );

  return (
    <>
      <PageHeader title="Settings" description="Test rules, scoring weights and integrations." actions={<Button onClick={save} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} Save settings</Button>} />
      <PageBody>
        {msg && <div role="status" className={`rounded-md border p-3 text-sm ${msg.ok ? "border-pass/30 bg-pass/10 text-pass" : "border-fail/30 bg-fail/10 text-fail"}`}>{msg.text}</div>}
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Quality score weights</CardTitle><CardDescription>Overall score = Σ(category score × weight) ÷ Σ(weights of tested categories). Current total: {totalW}.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {SCORE_GROUPS.map((g) => (
                <div key={g} className="space-y-1.5"><Label htmlFor={`w-${g}`}>{SCORE_GROUP_LABELS[g]}</Label><Input id={`w-${g}`} type="number" min={0} max={100} value={s.weights[g]} onChange={(e) => setS({ ...s, weights: { ...s.weights, [g]: Number(e.target.value) } })} /></div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Production readiness</CardTitle><CardDescription>A site with any open critical issue is never marked ready, whatever its score.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {num("productionThreshold", "Minimum overall score")}
              {num("maxHighIssuesForReady", "Max open High issues allowed")}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Test rules</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {num("imageWarnKb", "Image size warning (KB)")}
              {num("imageMaxKb", "Image size limit (KB)")}
              {num("lighthousePageLimit", "Lighthouse pages (full scan)", "Each page runs desktop + mobile")}
              {num("pageTimeoutMs", "Page timeout (ms)")}
              {num("concurrency", "Concurrent scans (1–4)")}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Form testing</CardTitle><CardDescription>Validation tests never send data: non-GET requests are blocked. Real submissions run only when enabled below.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={s.allowFormSubmission} onCheckedChange={(c) => set("allowFormSubmission", !!c)} />
                <span>Allow real form submissions<span className="mt-0.5 flex items-center gap-1 text-[11px] text-warn"><AlertTriangle className="size-3" /> Enable only for staging/test environments with a test mail server — never production.</span></span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                {(["name", "email", "phone", "message"] as const).map((k) => (
                  <div key={k} className="space-y-1.5"><Label htmlFor={`td-${k}`} className="capitalize">Test {k}</Label><Input id={`td-${k}`} value={s.formTestData[k]} onChange={(e) => setS({ ...s, formTestData: { ...s.formTestData, [k]: e.target.value } })} /></div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Google integrations</CardTitle><CardDescription>Expected IDs are validated against what each page loads.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {text("gtmContainerId", "GTM container ID", "GTM-XXXXXXX")}
              {text("ga4MeasurementId", "GA4 measurement ID", "G-XXXXXXXXXX")}
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="events">Expected dataLayer events (comma-separated)</Label><Input id="events" placeholder="page_view, gtm.dom" value={s.expectedDataLayerEvents.join(", ")} onChange={(e) => set("expectedDataLayerEvents", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></div>
              <div className="sm:col-span-2">{text("recaptchaVerifyEndpoint", "reCAPTCHA test verification endpoint", "https://staging.example.com/api/qa/verify-recaptcha", "Authorized test endpoint: POST { token, action } → { success, score }. This tool never handles the secret key.")}</div>
              <div className="sm:col-span-2">{text("cruxApiKey", "Chrome UX Report API key (for INP field data)", "AIza…", "Optional. Stored server-side and masked in the UI.")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Email template testing</CardTitle><CardDescription>Reads messages from a Mailpit/MailHog test inbox. This tool never sends email.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">{text("emailTestApi", "Test inbox API base URL", "http://localhost:8025")}</div>
              {text("emailExpectedSubject", "Expected subject contains")}
              {text("emailExpectedSender", "Expected sender address")}
              {text("emailAdminRecipient", "Admin notification recipient")}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

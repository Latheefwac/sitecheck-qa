"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Accessibility, Gauge, ListChecks, Loader2, Lock, Radar, Zap } from "lucide-react";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import type { AuthConfig, BrowserName, Project, Scan, ScanMode } from "@/lib/types";
import { A11Y_LEVELS, A11Y_LEVEL_INFO, type A11yLevel } from "@/lib/a11y-levels";
import { api, cn } from "@/lib/utils";
import { validateUrl } from "@/lib/url";
import { CATEGORY_INFO, CATEGORY_PRESETS, TESTABLE_CATEGORIES, type TestableCategory } from "@/lib/test-categories";

const BROWSERS: { id: BrowserName; label: string; note?: string }[] = [
  { id: "chromium", label: "Chrome (Chromium)" },
  { id: "firefox", label: "Firefox" },
  { id: "webkit", label: "Safari (WebKit)", note: "WebKit engine, not Apple Safari" },
  { id: "msedge", label: "Microsoft Edge", note: "Requires Edge installed" },
];

export default function NewScan() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<ScanMode>("quick");
  const [maxPages, setMaxPages] = useState(15);
  const [maxDepth, setMaxDepth] = useState(3);
  const [useSitemap, setUseSitemap] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [manual, setManual] = useState("");
  const [prod, setProd] = useState("");
  const [browsers, setBrowsers] = useState<BrowserName[]>(["chromium", "firefox", "webkit"]);
  const [auth, setAuth] = useState<AuthConfig>({ type: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [a11yPicked, setA11yPicked] = useState<A11yLevel | null>(null);
  const [catsPicked, setCatsPicked] = useState<TestableCategory[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    api<{ projects: Project[] }>("/api/projects").then((x) => setProjects(x.projects)).catch(() => {});
  }, []);

  const v = validateUrl(url);
  // Each project remembers the level its last scan used; new projects default to Basic (PageSpeed 100).
  const project = v.ok ? projects.find((p) => p.origin === new URL(v.url).origin) : undefined;
  const remembered = project?.latestScan?.a11yLevel;
  const a11yLevel: A11yLevel = a11yPicked ?? remembered ?? "basic";
  // Categories work the same way: the project's last choice, or everything for a new project.
  const rememberedCats = project?.latestScan?.categories;
  const categories: TestableCategory[] = catsPicked ?? rememberedCats ?? [...TESTABLE_CATEGORIES];
  const toggleCat = (c: TestableCategory, on: boolean) => setCatsPicked(TESTABLE_CATEGORIES.filter((x) => (x === c ? on : categories.includes(x))));
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const urlError = touched && url && !v.ok ? v.error : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!v.ok) return setError(v.error);
    if (!categories.length) return setError("Choose at least one test category.");
    setBusy(true);
    setError(null);
    try {
      const scan = await api<Scan>("/api/scans", {
        method: "POST",
        body: JSON.stringify({ url: v.url, mode, maxPages, maxDepth, useSitemap, autoStart, manualUrls: manual.split(/\s+/).filter(Boolean), browsers, productionBaseUrl: prod || undefined, a11yLevel, categories, auth: auth.type === "none" ? undefined : auth }),
      });
      router.push(`/scans/${scan.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New scan" description="Crawl a website, choose pages, and run the automated QA suite." />
      <PageBody>
        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3" noValidate>
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader><CardTitle>Website URL</CardTitle><CardDescription>Use a staging or pre-production URL. Only scan sites you are authorised to test.</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input id="url" inputMode="url" autoComplete="url" placeholder="https://staging.example.com" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={!!urlError} aria-describedby="url-msg" className={cn(urlError && "border-fail focus-visible:ring-fail")} />
                <p id="url-msg" className={cn("text-xs", urlError ? "text-fail" : "text-muted-foreground")}>{urlError ?? (v.ok && url ? `Will scan ${v.url}` : "http:// or https:// — the scheme is added automatically if omitted")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Scan mode</CardTitle></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Scan mode">
                {([
                  { id: "quick", icon: Zap, title: "Quick Scan", desc: "Core checks on all discovered pages, 3 viewports, Lighthouse mobile + animation + cross-browser on the homepage." },
                  { id: "full", icon: Gauge, title: "Full Scan", desc: "All 10 viewports, Lighthouse desktop & mobile, animation profiling, cross-browser and visual diffs across selected pages." },
                ] as const).map((m) => (
                  <button type="button" role="radio" aria-checked={mode === m.id} key={m.id} onClick={() => setMode(m.id)} className={cn("rounded-lg border p-4 text-left transition-colors hover:bg-accent cursor-pointer", mode === m.id && "border-brand ring-1 ring-brand bg-brand/5")}>
                    <div className="flex items-center gap-2 text-sm font-semibold"><m.icon className="size-4" /> {m.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{m.desc}</p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><ListChecks className="size-4" /> What to test</CardTitle>
                <CardDescription>
                  {project && rememberedCats && !catsPicked ? <>Using the categories from this project&apos;s last scan ({rememberedCats.length} of {TESTABLE_CATEGORIES.length}). </> : null}
                  Crawling and broken-link checks always run.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Category presets">
                  {CATEGORY_PRESETS.map((p) => (
                    <Button key={p.id} type="button" size="sm" variant={sameSet(categories, p.categories) ? "brand" : "outline"} aria-pressed={sameSet(categories, p.categories)} onClick={() => setCatsPicked([...p.categories])}>{p.label}</Button>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCatsPicked([])}>Clear</Button>
                  <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">{categories.length} of {TESTABLE_CATEGORIES.length} selected</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TESTABLE_CATEGORIES.map((c) => (
                    <label key={c} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors hover:bg-accent", categories.includes(c) && "border-brand/60 bg-brand/5")}>
                      <Checkbox className="mt-0.5" checked={categories.includes(c)} onCheckedChange={(on) => toggleCat(c, !!on)} />
                      <span><span className="font-medium">{CATEGORY_INFO[c].label}</span><span className="block text-xs text-muted-foreground">{CATEGORY_INFO[c].description}</span></span>
                    </label>
                  ))}
                </div>
                {!categories.length && <p className="text-xs text-fail">Choose at least one category.</p>}
              </CardContent>
            </Card>

            {categories.includes("accessibility") && <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><Accessibility className="size-4" /> Accessibility level</CardTitle>
                <CardDescription>
                  Choose what this project is held to.{" "}
                  {project && remembered && !a11yPicked ? <>Using <span className="font-medium text-foreground">{A11Y_LEVEL_INFO[remembered].short}</span> from this project&apos;s last scan.</> : "Saved with the scan and used again for this project next time."}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Accessibility level">
                {A11Y_LEVELS.map((l) => (
                  <button type="button" role="radio" aria-checked={a11yLevel === l} key={l} onClick={() => setA11yPicked(l)} className={cn("rounded-lg border p-4 text-left transition-colors hover:bg-accent cursor-pointer", a11yLevel === l && "border-brand ring-1 ring-brand bg-brand/5")}>
                    <div className="text-sm font-semibold">{A11Y_LEVEL_INFO[l].short}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{A11Y_LEVEL_INFO[l].description}</p>
                  </button>
                ))}
              </CardContent>
            </Card>}

            <Card>
              <CardHeader><CardTitle>Crawl options</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="mp">Max pages</Label><Input id="mp" type="number" min={1} max={500} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} /></div>
                <div className="space-y-1.5"><Label htmlFor="md">Max link depth</Label><Input id="md" type="number" min={0} max={10} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} /></div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="prod">Expected production base URL <span className="font-normal text-muted-foreground">(for canonical checks)</span></Label>
                  <Input id="prod" placeholder="https://www.example.com" value={prod} onChange={(e) => setProd(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="manual">Additional URLs <span className="font-normal text-muted-foreground">(one per line, absolute or relative)</span></Label>
                  <Textarea id="manual" rows={3} placeholder={"/careers\n/contact-us"} value={manual} onChange={(e) => setManual(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={useSitemap} onCheckedChange={(c) => setUseSitemap(!!c)} /> Use sitemap.xml & robots.txt</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={autoStart} onCheckedChange={(c) => setAutoStart(!!c)} /> Start tests automatically after crawling</label>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
{categories.includes("cross-browser") &&             <Card>
              <CardHeader><CardTitle>Browsers</CardTitle><CardDescription>Used for cross-browser checks (Playwright engines)</CardDescription></CardHeader>
              <CardContent className="space-y-2.5">
                {BROWSERS.map((b) => (
                  <label key={b.id} className="flex items-start gap-2 text-sm">
                    <Checkbox className="mt-0.5" checked={browsers.includes(b.id)} onCheckedChange={(c) => setBrowsers(c ? [...browsers, b.id] : browsers.filter((x) => x !== b.id))} />
                    <span>{b.label}{b.note && <span className="block text-[11px] text-muted-foreground">{b.note}</span>}</span>
                  </label>
                ))}
              </CardContent>
            </Card>}

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-1.5"><Lock className="size-3.5" /> Authentication</CardTitle><CardDescription>For password-protected staging. Credentials are encrypted at rest (AES-256-GCM) and never shown in reports.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <NativeSelect aria-label="Authentication type" className="w-full" value={auth.type} onChange={(e) => setAuth({ type: e.target.value as AuthConfig["type"] })}>
                  <option value="none">None</option>
                  <option value="basic">HTTP Basic auth</option>
                  <option value="cookie">Session cookie</option>
                  <option value="form">Login form</option>
                </NativeSelect>
                {(auth.type === "basic" || auth.type === "form") && (
                  <>
                    <Input aria-label="Username" placeholder="Username" autoComplete="off" value={auth.username ?? ""} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
                    <Input aria-label="Password" type="password" placeholder="Password" autoComplete="new-password" value={auth.password ?? ""} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
                  </>
                )}
                {auth.type === "cookie" && <Textarea aria-label="Cookie header" placeholder="session=abc123; other=value" value={auth.cookie ?? ""} onChange={(e) => setAuth({ ...auth, cookie: e.target.value })} />}
                {auth.type === "form" && (
                  <>
                    <Input aria-label="Login page URL" placeholder="Login page URL" value={auth.loginUrl ?? ""} onChange={(e) => setAuth({ ...auth, loginUrl: e.target.value })} />
                    <Input aria-label="Username field selector" placeholder="Username selector (optional)" value={auth.usernameSelector ?? ""} onChange={(e) => setAuth({ ...auth, usernameSelector: e.target.value })} />
                    <Input aria-label="Password field selector" placeholder="Password selector (optional)" value={auth.passwordSelector ?? ""} onChange={(e) => setAuth({ ...auth, passwordSelector: e.target.value })} />
                    <Input aria-label="Submit button selector" placeholder="Submit selector (optional)" value={auth.submitSelector ?? ""} onChange={(e) => setAuth({ ...auth, submitSelector: e.target.value })} />
                  </>
                )}
              </CardContent>
            </Card>

            {error && <div role="alert" className="rounded-md border border-fail/30 bg-fail/10 p-3 text-sm text-fail">{error}</div>}
            <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy || !categories.length}>
              {busy ? <Loader2 className="animate-spin" /> : <Radar />} {autoStart ? "Crawl & run tests" : "Discover pages"}
            </Button>
          </div>
        </form>
      </PageBody>
    </>
  );
}

import "server-only";
import { chromium } from "playwright";
import type { PageRecord, Severity } from "../../../types";
import type { ScanContext } from "../context";

type LhAudit = { score: number | null; numericValue?: number; displayValue?: string; title: string; details?: { overallSavingsMs?: number; overallSavingsBytes?: number; items?: Record<string, unknown>[] } };

const METRICS: { id: string; key: string; label: string; good: number; poor: number; unit: "ms" | "" ; sev: Severity; fix: string }[] = [
  { id: "first-contentful-paint", key: "fcp", label: "First Contentful Paint (FCP)", good: 1800, poor: 3000, unit: "ms", sev: "Medium", fix: "Reduce render-blocking CSS/JS, inline critical CSS, preconnect to critical origins." },
  { id: "largest-contentful-paint", key: "lcp", label: "Largest Contentful Paint (LCP)", good: 2500, poor: 4000, unit: "ms", sev: "High", fix: "Optimise the LCP image (preload, fetchpriority=high, WebP/AVIF), cut server response time, avoid lazy-loading above the fold." },
  { id: "cumulative-layout-shift", key: "cls", label: "Cumulative Layout Shift (CLS)", good: 0.1, poor: 0.25, unit: "", sev: "High", fix: "Reserve space for images/embeds/ads (width/height, aspect-ratio), avoid injecting content above existing content, use font-display: optional/swap with size-adjust." },
  { id: "speed-index", key: "si", label: "Speed Index", good: 3400, poor: 5800, unit: "ms", sev: "Medium", fix: "Prioritise above-the-fold content and reduce main-thread work." },
  { id: "total-blocking-time", key: "tbt", label: "Total Blocking Time (TBT, lab)", good: 200, poor: 600, unit: "ms", sev: "Medium", fix: "Split long tasks, defer non-critical JS, remove unused third-party scripts." },
  { id: "server-response-time", key: "ttfb", label: "Time to First Byte (TTFB)", good: 800, poor: 1800, unit: "ms", sev: "Medium", fix: "Enable server/CDN caching, reduce backend work, use a CDN close to users." },
];

const OPPORTUNITIES: { id: string; label: string; sev: Severity }[] = [
  { id: "bootup-time", label: "JavaScript execution time", sev: "Medium" },
  { id: "mainthread-work-breakdown", label: "Main-thread work", sev: "Low" },
  { id: "unused-css-rules", label: "Unused CSS", sev: "Low" },
  { id: "unused-javascript", label: "Unused JavaScript", sev: "Medium" },
  { id: "render-blocking-resources", label: "Render-blocking resources", sev: "Medium" },
  { id: "uses-text-compression", label: "Text compression (gzip/brotli)", sev: "Medium" },
  { id: "uses-long-cache-ttl", label: "Static asset caching", sev: "Low" },
  { id: "font-display", label: "Font loading (font-display)", sev: "Low" },
  { id: "modern-image-formats", label: "Image optimization: modern formats", sev: "Medium" },
  { id: "uses-optimized-images", label: "Image optimization: encoding", sev: "Medium" },
  { id: "uses-responsive-images", label: "Image optimization: responsive sizes", sev: "Low" },
  { id: "offscreen-images", label: "Defer offscreen images", sev: "Low" },
  { id: "unminified-javascript", label: "Minify JavaScript", sev: "Low" },
  { id: "unminified-css", label: "Minify CSS", sev: "Low" },
];

function fmt(v: number, unit: string) {
  return unit === "ms" ? (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`) : v.toFixed(3);
}

export async function performancePage(ctx: ScanContext, p: PageRecord, formFactor: "mobile" | "desktop") {
  const base = { category: "performance" as const, pageUrl: p.url, viewport: formFactor };
  const { default: lighthouse } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");
  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | null = null;
  try {
    chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"], logLevel: "silent" });
    const config = formFactor === "desktop" ? (await import("lighthouse/core/config/desktop-config.js")).default : undefined;
    const extraHeaders = await ctx.authHeaders();
    const runner = await lighthouse(p.url, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance"], extraHeaders, formFactor, screenEmulation: formFactor === "mobile" ? undefined : { disabled: true } }, config);
    const lhr = runner?.lhr;
    if (!lhr) throw new Error("Lighthouse returned no result");
    if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
    const audits = lhr.audits as Record<string, LhAudit>;
    const score = Math.round((lhr.categories.performance.score ?? 0) * 100);

    ctx.check({ ...base, checkKey: `perf.score.${formFactor}`, title: `Lighthouse performance score (${formFactor})`, description: `Lighthouse ${lhr.lighthouseVersion} lab test, ${formFactor} emulation`, expected: "≥ 90 (good), ≥ 50 (needs improvement)", actual: `${score} / 100`, severity: score < 50 ? "High" : "Medium", recommendation: score < 90 ? "Address the metric and opportunity findings below in order of impact." : null, meta: { toolScore: score, formFactor } }, score >= 90 ? true : score >= 50 ? "warn" : false);

    const metrics: Record<string, number> = {};
    for (const m of METRICS) {
      const a = audits[m.id];
      if (!a || a.numericValue === undefined) continue;
      const v = a.numericValue;
      metrics[m.key] = v;
      const status = v <= m.good ? true : v <= m.poor ? "warn" : false;
      ctx.check({ ...base, checkKey: `perf.${m.key}.${formFactor}`, title: `${m.label} (${formFactor})`, description: m.key === "tbt" ? "Lab metric. TBT is a diagnostic proxy and is NOT a replacement for INP field data." : `Core Web Vitals${["lcp", "cls"].includes(m.key) ? "" : " supporting"} metric`, expected: `≤ ${fmt(m.good, m.unit)}`, actual: fmt(v, m.unit), severity: m.sev, recommendation: status === true ? null : m.fix, meta: { value: v } }, status);
    }
    const lcpEl = audits["largest-contentful-paint-element"]?.details?.items?.[0] as { items?: { node?: { snippet?: string } }[] } | undefined;
    if (lcpEl?.items?.[0]?.node?.snippet) ctx.log("info", `LCP element (${formFactor}) on ${p.url}: ${lcpEl.items[0].node.snippet.slice(0, 200)}`);

    for (const o of OPPORTUNITIES) {
      const a = audits[o.id];
      if (!a || a.score === null || a.score === undefined) continue;
      const save = a.details?.overallSavingsMs ? `~${Math.round(a.details.overallSavingsMs)} ms` : a.details?.overallSavingsBytes ? `~${Math.round(a.details.overallSavingsBytes / 1024)} KB` : "";
      const items = (a.details?.items ?? []).slice(0, 6).map((i) => String(i.url ?? i.groupLabel ?? i.source ?? "")).filter(Boolean);
      ctx.check({ ...base, checkKey: `perf.${o.id}.${formFactor}`, title: `${o.label} (${formFactor})`, description: a.title, expected: "Passes Lighthouse audit", actual: `${a.displayValue ?? (a.score >= 0.9 ? "Passed" : "Needs work")}${save ? ` — potential savings ${save}` : ""}${items.length ? `\n${items.join("\n")}` : ""}`, severity: o.sev, recommendation: a.score >= 0.9 ? null : `Lighthouse: ${a.title}. See https://developer.chrome.com/docs/lighthouse/performance/${o.id}/` }, a.score >= 0.9 ? true : a.score >= 0.5 ? "warn" : false);
    }

    await inpFieldData(ctx, p.url, formFactor);
    return { score, metrics };
  } catch (e) {
    ctx.notTested({ ...base, checkKey: `perf.score.${formFactor}`, title: `Lighthouse performance (${formFactor})`, description: "Lighthouse lab test", reason: `Lighthouse could not run: ${(e as Error).message}`, severity: "High" });
    return null;
  } finally {
    await chrome?.kill();
  }
}

/** INP is a field metric — only report it from real-user CrUX data when an API key is configured. */
async function inpFieldData(ctx: ScanContext, url: string, formFactor: "mobile" | "desktop") {
  const base = { category: "performance" as const, pageUrl: url, viewport: formFactor, checkKey: `perf.inp.${formFactor}`, title: `Interaction to Next Paint (INP, ${formFactor} field data)`, description: "75th percentile INP from the Chrome UX Report (real users)" };
  const key = ctx.settings.cruxApiKey;
  if (!key) {
    ctx.notTested({ ...base, reason: "INP requires field data. Configure a CrUX API key in Settings. Lighthouse TBT is not used as a substitute.", expected: "≤ 200 ms", severity: "Medium" });
    return;
  }
  try {
    const q = async (body: Record<string, unknown>) => {
      const r = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, formFactor: formFactor === "mobile" ? "PHONE" : "DESKTOP", metrics: ["interaction_to_next_paint"] }) });
      return r.ok ? ((await r.json()) as { record?: { metrics?: { interaction_to_next_paint?: { percentiles?: { p75?: number | string } } } } }) : null;
    };
    let level = "URL";
    let data = await q({ url });
    if (!data?.record) {
      level = "origin";
      data = await q({ origin: new URL(url).origin });
    }
    const p75 = Number(data?.record?.metrics?.interaction_to_next_paint?.percentiles?.p75);
    if (!Number.isFinite(p75)) {
      ctx.notTested({ ...base, reason: "Not enough real-user traffic in CrUX for this URL or origin.", expected: "≤ 200 ms", severity: "Medium" });
      return;
    }
    ctx.check({ ...base, expected: "≤ 200 ms", actual: `${p75} ms (p75, ${level}-level CrUX)`, severity: "High", recommendation: p75 > 200 ? "Break up long tasks in event handlers, yield to the main thread, and reduce third-party script cost." : null, meta: { value: p75 } }, p75 <= 200 ? true : p75 <= 500 ? "warn" : false);
  } catch (e) {
    ctx.notTested({ ...base, reason: `CrUX request failed: ${(e as Error).message}`, expected: "≤ 200 ms", severity: "Medium" });
  }
}

import "server-only";
import { deleteResults, getScan, getScanAuth, getSettings, listPages, listResults, updateScan } from "../db";
import { decryptAuth } from "../secrets";
import { computeScores, summarize } from "../../scoring";
import type { Category, PageRecord } from "../../types";
import { categoriesText, runsCategory } from "../../test-categories";
import { ScanContext, bus, forEachPage, type ScanEvent } from "./context";
import { discover } from "./crawler";
import { accessibilityPage } from "./modules/accessibility";
import { animationPage } from "./modules/animation";
import { crossBrowserPage } from "./modules/crossbrowser";
import { emailChecks } from "./modules/email";
import { formsPage } from "./modules/forms";
import { functionalPage, functionalSite } from "./modules/functional";
import { imagesPage, imagesSite } from "./modules/images";
import { integrationsPage } from "./modules/integrations";
import { performancePage } from "./modules/performance";
import { responsivePage } from "./modules/responsive";
import { captureNetwork, securityPage, securitySite } from "./modules/security";
import { seoPage, seoSite, type SeoData } from "./modules/seo";

const active = new Map<string, ScanContext>();
export const cancelScan = (id: string) => {
  const c = active.get(id);
  if (c) c.cancelled = true;
  return !!c;
};

function makeCtx(scanId: string) {
  const scan = getScan(scanId);
  if (!scan) throw new Error(`Scan ${scanId} not found`);
  const ctx = new ScanContext(scanId, scan.url, scan.options, getSettings(), decryptAuth(getScanAuth(scanId)));
  active.set(scanId, ctx);
  return { scan, ctx };
}

function status(scanId: string, s: string) {
  bus.emit(`scan:${scanId}`, { type: "status", scanId, status: s } satisfies ScanEvent);
}

export function rescore(scanId: string) {
  const results = listResults(scanId);
  const pages = listPages(scanId).filter((p) => p.selected).length;
  const settings = getSettings();
  updateScan(scanId, { scores: computeScores(results, settings), summary: summarize(results, pages) });
}

export async function runDiscovery(scanId: string): Promise<boolean> {
  const { ctx } = makeCtx(scanId);
  try {
    updateScan(scanId, { status: "discovering", startedAt: new Date().toISOString() });
    ctx.log("info", `Discovery started for ${ctx.rootUrl} (${ctx.options.mode} scan, max ${ctx.options.maxPages} pages)`);
    await discover(ctx);
    const pages = listPages(scanId);
    ctx.log("info", `Discovered ${pages.length} page(s); ${pages.filter((p) => p.selected).length} selected for testing`);
    updateScan(scanId, { status: "ready", progress: 100, phase: "Pages discovered — select pages and start testing" });
    status(scanId, "ready");
    return true;
  } catch (e) {
    ctx.log("error", `Discovery failed: ${(e as Error).message}`);
    updateScan(scanId, { status: "failed", error: (e as Error).message, finishedAt: new Date().toISOString() });
    status(scanId, "failed");
    return false;
  } finally {
    await ctx.close();
    active.delete(scanId);
  }
}

const SITE_KEYS = /^(seo\.(duplicate-|missing-metadata|robots-txt|sitemap|favicon|https-redirect|www)|sec\.exposed-file|fun\.404|img\.duplicates)/;
const CORE: Category[] = ["seo", "security", "integrations", "accessibility", "images", "functional"];
const ALL: Category[] = [...CORE, "responsive", "forms", "animation", "performance", "cross-browser", "email"];

/** Runs the test suite. `only` limits to category→pageUrls pairs (used for re-running failed tests). */
export async function runTests(scanId: string, only?: Map<Category, Set<string>>) {
  const { ctx } = makeCtx(scanId);
  const started = new Date();
  // A category runs if the scan includes it and (when re-running) it has failures to re-check.
  const want = (c: Category) => runsCategory(ctx.options, c) && (!only || only.has(c));
  const pagesFor = (c: Category, pages: PageRecord[]) => (only ? pages.filter((p) => only.get(c)?.has(p.url)) : pages);
  try {
    updateScan(scanId, { status: "running", progress: 0, phase: "Starting", error: null, ...(only ? {} : { startedAt: started.toISOString() }) });
    status(scanId, "running");
    const pages = listPages(scanId).filter((p) => p.selected);
    if (!pages.length) throw new Error("No pages selected for testing");
    const home = pages.find((p) => p.depth === 0) ?? pages[0];
    ctx.log("info", `${only ? "Re-running failed tests" : "Testing"} ${pages.length} page(s) — mode: ${ctx.options.mode} · ${categoriesText(ctx.options)}`);

    // 1) Core pass — one desktop page load per page shared by six modules
    const seoData = new Map<string, SeoData>();
    const coreWanted = CORE.filter(want);
    const corePages = !coreWanted.length ? [] : only ? pages.filter((p) => coreWanted.some((c) => only.get(c)?.has(p.url))) : pages;
    await forEachPage(ctx, corePages, "Core checks", 0, 35, async (p) => {
      const bctx = await ctx.newContext("chromium", { viewport: { width: 1440, height: 900 } });
      try {
        const page = await bctx.newPage();
        const cap = captureNetwork(page);
        const resp = await page.goto(p.url, { waitUntil: "load", timeout: ctx.settings.pageTimeoutMs });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        const headers = (await resp?.allHeaders()) ?? {};
        const has = (c: Category) => want(c) && (!only || only.get(c)?.has(p.url));
        if (has("seo")) seoData.set(p.url, await seoPage(ctx, p, page));
        if (has("security")) await securityPage(ctx, p, page, cap, headers);
        if (has("integrations")) await integrationsPage(ctx, p, page, cap);
        if (has("accessibility")) await accessibilityPage(ctx, p, page);
        if (has("images")) await imagesPage(ctx, p, page);
        if (has("functional")) await functionalPage(ctx, p, page);
      } finally {
        await bctx.close();
      }
    });

    // 2) Responsive
    if (want("responsive")) await forEachPage(ctx, pagesFor("responsive", ctx.full ? pages : pages.slice(0, 10)), "Responsive", 35, 20, (p) => responsivePage(ctx, p));
    // 3) Forms
    if (want("forms")) await forEachPage(ctx, pagesFor("forms", pages), "Forms", 55, 8, (p) => formsPage(ctx, p));
    // 4) Animation
    if (want("animation")) await forEachPage(ctx, pagesFor("animation", ctx.full ? pages.slice(0, 15) : [home]), "Animation", 63, 10, (p) => animationPage(ctx, p));
    // 5) Performance (Lighthouse) — separate desktop and mobile runs
    if (want("performance")) {
      const perfPages = pagesFor("performance", ctx.full ? pages.slice(0, ctx.settings.lighthousePageLimit) : [home]);
      const factors = ctx.full ? (["mobile", "desktop"] as const) : (["mobile"] as const);
      await forEachPage(ctx, perfPages, "Lighthouse", 73, 15, async (p) => {
        for (const f of factors) await performancePage(ctx, p, f);
      });
    }
    // 6) Cross-browser
    if (want("cross-browser")) await forEachPage(ctx, pagesFor("cross-browser", ctx.full ? pages.slice(0, 5) : [home]), "Cross-browser", 88, 7, (p) => crossBrowserPage(ctx, p));

    // 7) Site-level checks
    if (!ctx.cancelled) {
      ctx.progress(95, "Site-wide checks");
      const safe = async (name: string, fn: () => Promise<void> | void) => {
        try {
          await fn();
        } catch (e) {
          ctx.log("error", `${name} failed: ${(e as Error).message}`);
        }
      };
      if (want("seo")) await safe("SEO site checks", () => seoSite(ctx, seoData));
      if (want("security")) await safe("Security site checks", () => securitySite(ctx));
      if (want("functional")) await safe("404 check", () => functionalSite(ctx));
      if (want("images")) await safe("Image duplicates", () => imagesSite(ctx));
      if (want("email") && !only) await safe("Email checks", () => emailChecks(ctx, started));
    }

    rescore(scanId);
    const final = ctx.cancelled ? "cancelled" : "completed";
    updateScan(scanId, { status: final, progress: 100, phase: final === "completed" ? "Completed" : "Cancelled", finishedAt: new Date().toISOString() });
    ctx.log("info", `Scan ${final}: ${ctx.counts.pass} passed, ${ctx.counts.fail} failed, ${ctx.counts.warning} warnings, ${ctx.counts.notTested} not tested`);
    status(scanId, final);
  } catch (e) {
    ctx.log("error", `Scan failed: ${(e as Error).message}`);
    rescore(scanId);
    updateScan(scanId, { status: "failed", error: (e as Error).message, finishedAt: new Date().toISOString() });
    status(scanId, "failed");
  } finally {
    await ctx.close();
    active.delete(scanId);
  }
}

/** Re-runs every category/page pair that has a FAIL, replacing the previous results for those pairs. */
export async function rerunFailed(scanId: string) {
  const results = listResults(scanId);
  const failed = results.filter((r) => r.status === "FAIL" && !r.resolved && r.category !== "crawl");
  const only = new Map<Category, Set<string>>();
  for (const r of failed) (only.get(r.category) ?? only.set(r.category, new Set()).get(r.category)!).add(r.pageUrl);
  if (!only.size) return 0;
  // Replace results for the re-run (category, page) pairs plus every site-level check of re-run categories.
  const doomed = results.filter((r) => r.category !== "crawl" && only.has(r.category) && (only.get(r.category)!.has(r.pageUrl) || SITE_KEYS.test(r.checkKey))).map((r) => r.id);
  // Duplicate-title/description checks need every page's SEO data; include all pages for SEO re-runs.
  if (only.has("seo")) for (const p of listPages(scanId).filter((p) => p.selected)) only.get("seo")!.add(p.url);
  deleteResults(scanId, doomed);
  await runTests(scanId, only);
  return failed.length;
}

export { ALL as ALL_CATEGORIES };

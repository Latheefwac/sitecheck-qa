import "server-only";
import { insertScreenshot } from "../../db";
import type { BrowserName, PageRecord } from "../../../types";
import { slugFromUrl } from "../../../url";
import type { ScanContext } from "../context";
import { captureNetwork } from "./security";

const LABEL: Record<BrowserName, string> = { chromium: "Chrome (Chromium)", firefox: "Firefox", webkit: "Safari (WebKit)", msedge: "Microsoft Edge" };
const LIMITS: Record<BrowserName, string> = {
  chromium: "Playwright Chromium build; matches Chrome rendering closely.",
  firefox: "Playwright-patched Firefox build.",
  webkit: "Playwright WebKit build — approximates Safari but is not Apple Safari; iOS-specific behaviour (toolbar resizing, momentum scroll) is not covered.",
  msedge: "Requires Microsoft Edge installed on the host; uses the Chromium engine.",
};

interface Snapshot {
  height: number;
  headerTop: number | null;
  h1: { x: number; y: number; w: number } | null;
  fontsStatus: string;
  fontsLoaded: string[];
  fontsFailed: number;
  navLinks: number;
  formControls: number;
  anims: number;
}

export async function crossBrowserPage(ctx: ScanContext, p: PageRecord) {
  const browsers = ctx.options.browsers.length ? ctx.options.browsers : ["chromium", "firefox", "webkit"];
  const snaps = new Map<BrowserName, Snapshot>();
  for (const b of browsers as BrowserName[]) {
    const base = { category: "cross-browser" as const, pageUrl: p.url, browser: b, viewport: "desktop-1440" };
    let opened;
    try {
      const bctx = await ctx.newContext(b, { viewport: { width: 1440, height: 900 } });
      const page = await bctx.newPage();
      const cap = captureNetwork(page);
      await page.goto(p.url, { waitUntil: "load", timeout: ctx.settings.pageTimeoutMs });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      opened = { bctx, page, cap };
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      const missing = /Executable doesn't exist|is not found|channel/i.test(msg);
      ctx.notTested({ ...base, checkKey: `xbr.load.${b}`, title: `${LABEL[b]}: page load`, description: LIMITS[b], reason: missing ? `${LABEL[b]} is not installed on this machine (${b === "msedge" ? "install Microsoft Edge" : "run npx playwright install"})` : `Failed: ${msg}`, severity: "Medium" });
      continue;
    }
    const { bctx, page, cap } = opened;
    try {
      const snap: Snapshot = await page.evaluate(async () => {
        await document.fonts.ready;
        const fonts = [...document.fonts];
        const h1 = document.querySelector("h1")?.getBoundingClientRect();
        const header = document.querySelector("header")?.getBoundingClientRect();
        return {
          height: document.documentElement.scrollHeight,
          headerTop: header ? Math.round(header.height) : null,
          h1: h1 ? { x: Math.round(h1.x), y: Math.round(h1.y), w: Math.round(h1.width) } : null,
          fontsStatus: document.fonts.status,
          fontsLoaded: [...new Set(fonts.filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")))],
          fontsFailed: fonts.filter((f) => f.status === "error").length,
          navLinks: [...document.querySelectorAll("nav a, header a")].filter((a) => a.getBoundingClientRect().width > 0).length,
          formControls: document.querySelectorAll("form input, form textarea, form select, form button").length,
          anims: document.getAnimations ? document.getAnimations().length : 0,
        };
      });
      snaps.set(b, snap);
      const shot = await ctx.shot(page, `${slugFromUrl(p.url)}-${b}`, { fullPage: true, maxHeight: 6000 });
      if (shot) insertScreenshot({ scanId: ctx.scanId, pageUrl: p.url, viewport: "desktop-1440", browser: b, path: shot, diffPath: null, diffRatio: null });

      const errs = [...cap.pageErrors.map((e) => `Uncaught: ${e}`), ...cap.consoleErrors];
      ctx.check({ ...base, checkKey: `xbr.console.${b}`, title: `${LABEL[b]}: console errors`, description: `JavaScript errors in ${LABEL[b]}. ${LIMITS[b]}`, expected: "0 errors", actual: errs.length ? errs.slice(0, 8).join("\n") : "No errors", severity: cap.pageErrors.length ? "High" : "Medium", screenshot: errs.length ? shot : null, recommendation: errs.length ? "Fix browser-specific errors (unsupported APIs, missing polyfills, CSP differences)." : null }, errs.length === 0);
      ctx.check({ ...base, checkKey: `xbr.fonts.${b}`, title: `${LABEL[b]}: font rendering`, description: "Web fonts load without errors", expected: "All font faces loaded", actual: `Loaded: ${snap.fontsLoaded.join(", ") || "system fonts only"}; failed: ${snap.fontsFailed}`, severity: "Medium", recommendation: snap.fontsFailed ? "Serve WOFF2 with correct CORS headers and font-display: swap." : null }, snap.fontsFailed === 0);
      ctx.check({ ...base, checkKey: `xbr.nav.${b}`, title: `${LABEL[b]}: navigation`, description: "Navigation links render", expected: "≥ 1 visible nav link", actual: `${snap.navLinks} visible nav link(s)`, severity: "High", recommendation: snap.navLinks ? null : "Navigation is not visible in this browser — check CSS feature support (e.g. :has(), container queries)." }, snap.navLinks > 0);
    } finally {
      await bctx.close();
    }
  }

  // compare against Chromium as the reference engine
  const ref = snaps.get("chromium") ?? [...snaps.values()][0];
  if (!ref) return;
  for (const [b, s] of snaps) {
    if (s === ref) continue;
    const base = { category: "cross-browser" as const, pageUrl: p.url, browser: b, viewport: "desktop-1440" };
    const hDiff = Math.abs(s.height - ref.height) / Math.max(ref.height, 1);
    const h1Shift = s.h1 && ref.h1 ? Math.max(Math.abs(s.h1.x - ref.h1.x), Math.abs(s.h1.y - ref.h1.y)) : 0;
    const issues = [hDiff > 0.05 ? `Page height differs by ${(hDiff * 100).toFixed(1)}% (${s.height}px vs ${ref.height}px)` : "", h1Shift > 20 ? `H1 position shifted ${h1Shift}px` : "", s.navLinks !== ref.navLinks ? `Visible nav links ${s.navLinks} vs ${ref.navLinks}` : "", s.formControls !== ref.formControls ? `Form controls ${s.formControls} vs ${ref.formControls}` : "", Math.abs(s.anims - ref.anims) > 3 ? `Running animations ${s.anims} vs ${ref.anims}` : ""].filter(Boolean);
    ctx.check({ ...base, checkKey: `xbr.layout.${b}`, title: `${LABEL[b]}: layout consistency vs Chromium`, description: "Page height, heading position, navigation, forms and animations match the reference engine", expected: "Height within 5%, H1 within 20px, same nav/form/animation counts", actual: issues.length ? issues.join("\n") : "Consistent with Chromium", severity: hDiff > 0.15 ? "High" : "Medium", recommendation: issues.length ? "Compare the browser screenshots; check flex gap, :has(), aspect-ratio, backdrop-filter and date-input support." : null }, issues.length === 0 ? true : hDiff > 0.15 ? false : "warn");
  }
}

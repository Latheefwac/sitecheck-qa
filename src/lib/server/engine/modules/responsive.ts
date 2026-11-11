import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { Page } from "playwright";
import { DATA_DIR, findScreenshot, getScan, insertScreenshot } from "../../db";
import { QUICK_VIEWPORTS, VIEWPORTS, type PageRecord } from "../../../types";
import { slugFromUrl } from "../../../url";
import type { ScanContext } from "../context";

interface LayoutAudit {
  scrollW: number;
  innerW: number;
  overflowing: string[];
  overlaps: string[];
  smallText: number;
  tinyTargets: string[];
  offscreenButtons: string[];
  navVisible: boolean;
  menuToggleVisible: boolean;
  hiddenImportant: string[];
  brokenImages: string[];
  imgOverflow: string[];
  misaligned: string[];
}

async function audit(page: Page, mobile: boolean): Promise<LayoutAudit> {
  return page.evaluate((mobile) => {
    const vw = document.documentElement.clientWidth;
    const desc = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity) > 0.05 && r.width > 0 && r.height > 0;
    };
    const all = [...document.querySelectorAll<HTMLElement>("body *")].slice(0, 4000);

    // elements causing horizontal overflow (ignore those clipped by an overflow:hidden ancestor)
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "hidden" || o === "clip" || o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    const overflowing = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 2 || r.left < -2) && getComputedStyle(el).position !== "fixed" && visible(el) && !clipped(el);
    }).map((el) => `${desc(el)} (right=${Math.round(el.getBoundingClientRect().right)}px, viewport=${vw}px)`).slice(0, 12);

    // text overlap: leaf text blocks whose rects intersect significantly
    const texts = all.filter((el) => visible(el) && el.childElementCount === 0 && (el.textContent ?? "").trim().length > 2 && getComputedStyle(el).position !== "absolute").slice(0, 300);
    const rects = texts.map((el) => ({ el, r: el.getBoundingClientRect() }));
    const overlaps: string[] = [];
    for (let i = 0; i < rects.length && overlaps.length < 8; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        if (rects[i].el.contains(rects[j].el) || rects[j].el.contains(rects[i].el)) continue;
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 4 && iy > 4 && ix * iy > 0.3 * Math.min(a.width * a.height, b.width * b.height)) {
          overlaps.push(`"${(rects[i].el.textContent ?? "").trim().slice(0, 30)}" ↔ "${(rects[j].el.textContent ?? "").trim().slice(0, 30)}"`);
          if (overlaps.length >= 8) break;
        }
      }

    const smallText = mobile ? texts.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12).length : 0;
    const targets = [...document.querySelectorAll("a[href], button, [role=button], input[type=submit]")].filter(visible);
    const tinyTargets = mobile ? targets.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map((el) => `${desc(el)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`).slice(0, 10) : [];
    const offscreenButtons = [...document.querySelectorAll("button, .btn, [class*=button], a[class*=btn]")].filter(visible).filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).map(desc).slice(0, 10);

    const nav = document.querySelector("header nav, nav, [role=navigation]");
    const navVisible = !!nav && visible(nav) && [...nav.querySelectorAll("a")].some(visible);
    const toggle = [...document.querySelectorAll("button, [role=button], .hamburger, .menu-toggle, .navbar-toggler, [class*=burger], [aria-controls][aria-expanded]")].find((el) => visible(el) && /menu|nav|burger|toggle/i.test(`${el.className} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("aria-controls") ?? ""} ${el.textContent ?? ""}`));

    const hiddenImportant = ["h1", "header", "footer", "main"].filter((s) => { const el = document.querySelector(s); return el && !visible(el); });
    const brokenImages = [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0 && visible(i)).map((i) => i.src).slice(0, 5);
    const imgOverflow = [...document.querySelectorAll("img, video, iframe")].filter((el) => { const r = el.getBoundingClientRect(); const p = el.parentElement?.getBoundingClientRect(); return visible(el) && p && r.width > p.width + 4 && !clipped(el); }).map(desc).slice(0, 8);

    // misalignment: siblings in a row whose tops differ slightly (1–6px) — common flex/grid bug
    const misaligned: string[] = [];
    document.querySelectorAll<HTMLElement>("[class*=row], [class*=grid], ul, .cards, [class*=col]").forEach((c) => {
      if (misaligned.length > 5) return;
      const s = getComputedStyle(c);
      if (!(s.display.includes("flex") && s.flexDirection.startsWith("row")) && !s.display.includes("grid")) return;
      const kids = [...c.children].filter(visible).map((k) => k.getBoundingClientRect());
      for (let i = 1; i < kids.length; i++) {
        const d = Math.abs(kids[i].top - kids[i - 1].top);
        if (d > 1 && d < 6 && Math.abs(kids[i].left - kids[i - 1].left) > 10) { misaligned.push(`${desc(c)} items offset by ${d.toFixed(1)}px`); break; }
      }
    });

    return { scrollW: document.documentElement.scrollWidth, innerW: vw, overflowing, overlaps, smallText, tinyTargets, offscreenButtons, navVisible, menuToggleVisible: !!toggle, hiddenImportant, brokenImages, imgOverflow, misaligned };
  }, mobile);
}

function diffAgainstBaseline(currentAbs: string, baselineAbs: string, outAbs: string): number | null {
  try {
    const a = PNG.sync.read(fs.readFileSync(currentAbs));
    const b = PNG.sync.read(fs.readFileSync(baselineAbs));
    const w = Math.min(a.width, b.width);
    const h = Math.min(a.height, b.height);
    const crop = (img: PNG) => {
      const out = new PNG({ width: w, height: h });
      PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
      return out;
    };
    const ca = crop(a), cb = crop(b);
    const diff = new PNG({ width: w, height: h });
    const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.1, includeAA: false });
    fs.writeFileSync(outAbs, PNG.sync.write(diff));
    const heightDelta = Math.abs(a.height - b.height) / Math.max(a.height, b.height);
    return Math.min(1, n / (w * h) + heightDelta);
  } catch {
    return null;
  }
}

export async function responsivePage(ctx: ScanContext, p: PageRecord) {
  const vps = VIEWPORTS.filter((v) => ctx.full || QUICK_VIEWPORTS.includes(v.name));
  for (const vp of vps) {
    if (ctx.cancelled) return;
    const mobile = vp.width < 768;
    const { ctx: bctx, page } = await ctx.openPage(p.url, { context: { viewport: { width: vp.width, height: vp.height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 } });
    try {
      const base = { category: "responsive" as const, pageUrl: p.url, viewport: vp.name };
      const shot = await ctx.shot(page, `${slugFromUrl(p.url)}-${vp.name}`, { fullPage: true, type: "png", maxHeight: 8000 });
      let diffRatio: number | null = null;
      let diffPath: string | null = null;
      if (shot) {
        const scan = getScan(ctx.scanId);
        const prev = scan?.baselineScanId ? findScreenshot(scan.baselineScanId, p.url, vp.name, "chromium") : undefined;
        if (prev && fs.existsSync(path.join(DATA_DIR, prev.path))) {
          const out = shot.replace(/\.png$/, "-diff.png");
          diffRatio = diffAgainstBaseline(path.join(DATA_DIR, shot), path.join(DATA_DIR, prev.path), path.join(DATA_DIR, out));
          if (diffRatio !== null) diffPath = out;
        }
      }
      if (shot) insertScreenshot({ scanId: ctx.scanId, pageUrl: p.url, viewport: vp.name, browser: "chromium", path: shot, diffPath, diffRatio });

      const a = await audit(page, mobile);
      const hOverflow = a.scrollW > a.innerW + 1;
      ctx.check({ ...base, checkKey: `rsp.overflow`, title: `Horizontal overflow @ ${vp.width}px`, description: "Page does not scroll horizontally", expected: `scrollWidth ≤ ${a.innerW}px`, actual: hOverflow ? `scrollWidth ${a.scrollW}px > ${a.innerW}px\n${a.overflowing.join("\n")}` : "No horizontal overflow", severity: mobile ? "High" : "Medium", screenshot: hOverflow ? shot : null, recommendation: hOverflow ? "Constrain the listed elements (max-width:100%, flex-wrap, overflow-wrap:anywhere) at this breakpoint." : null }, !hOverflow);
      ctx.check({ ...base, checkKey: `rsp.overlap`, title: `Text overlapping @ ${vp.width}px`, description: "Text blocks do not overlap each other", expected: "No overlapping text", actual: a.overlaps.length ? a.overlaps.join("\n") : "None", severity: "Medium", screenshot: a.overlaps.length ? shot : null, recommendation: a.overlaps.length ? "Check absolute positioning, negative margins and fixed heights at this breakpoint." : null }, a.overlaps.length === 0);
      ctx.check({ ...base, checkKey: `rsp.images`, title: `Image scaling @ ${vp.width}px`, description: "Media fits its container and loads", expected: "Images ≤ container width, none broken", actual: [...a.imgOverflow.map((i) => `Overflows container: ${i}`), ...a.brokenImages.map((i) => `Broken: ${i}`)].join("\n") || "OK", severity: "Medium", recommendation: a.imgOverflow.length ? "Add img, video, iframe { max-width: 100%; height: auto; }." : null }, a.imgOverflow.length + a.brokenImages.length === 0);
      ctx.check({ ...base, checkKey: `rsp.buttons`, title: `Button positioning @ ${vp.width}px`, description: "Buttons are fully on-screen" + (mobile ? " and at least 24×24px" : ""), expected: "All buttons visible and tappable", actual: [...a.offscreenButtons.map((b) => `Off-screen: ${b}`), ...a.tinyTargets.map((t) => `Small target: ${t}`)].join("\n") || "OK", severity: a.offscreenButtons.length ? "High" : "Low", recommendation: a.offscreenButtons.length || a.tinyTargets.length ? "Ensure buttons wrap within the viewport; give touch targets min 44×44px (WCAG 2.5.8 minimum 24px)." : null }, a.offscreenButtons.length ? false : a.tinyTargets.length > 3 ? "warn" : true);
      ctx.check({ ...base, checkKey: `rsp.navigation`, title: `Navigation available @ ${vp.width}px`, description: mobile ? "Either nav links or a menu toggle is visible" : "Navigation links are visible", expected: "Navigation reachable", actual: `Nav links visible: ${a.navVisible ? "yes" : "no"}; menu toggle visible: ${a.menuToggleVisible ? "yes" : "no"}`, severity: "High", recommendation: a.navVisible || a.menuToggleVisible ? null : "Show a hamburger/menu button when the desktop nav is hidden." }, a.navVisible || a.menuToggleVisible);
      ctx.check({ ...base, checkKey: `rsp.visibility`, title: `Element visibility @ ${vp.width}px`, description: "Key landmarks (h1, header, main, footer) are visible", expected: "All visible", actual: a.hiddenImportant.length ? `Hidden: ${a.hiddenImportant.join(", ")}` : "All key elements visible", severity: "Medium", recommendation: a.hiddenImportant.length ? "Check display:none rules in media queries." : null }, a.hiddenImportant.length === 0);
      ctx.check({ ...base, checkKey: `rsp.alignment`, title: `Alignment @ ${vp.width}px`, description: "Items in rows/grids share a baseline", expected: "No 1–6px misalignment", actual: a.misaligned.join("\n") || "OK", severity: "Low", recommendation: a.misaligned.length ? "Use align-items and consistent margins on grid/flex children." : null }, a.misaligned.length ? "warn" : true);
      if (mobile) ctx.check({ ...base, checkKey: `rsp.font-size`, title: `Readable text @ ${vp.width}px`, description: "Body text is at least 12px on mobile", expected: "0 text blocks < 12px", actual: `${a.smallText} text block(s) under 12px`, severity: "Low", recommendation: a.smallText ? "Use ≥ 16px body text on mobile." : null }, a.smallText > 5 ? "warn" : true);
      if (diffRatio !== null)
        ctx.check({ ...base, checkKey: `rsp.visual-diff`, title: `Visual change vs previous scan @ ${vp.width}px`, description: "Pixel difference against the last completed scan of this site", expected: "≤ 5% of pixels changed (unless intended)", actual: `${(diffRatio * 100).toFixed(2)}% pixels differ`, severity: "Low", screenshot: diffPath, recommendation: diffRatio > 0.05 ? "Review the highlighted diff image; confirm the change was intentional." : null, meta: { diffRatio } }, diffRatio > 0.05 ? "warn" : true);
    } finally {
      await bctx.close();
    }
  }
}

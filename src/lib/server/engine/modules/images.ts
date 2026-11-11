import "server-only";
import crypto from "node:crypto";
import type { Page } from "playwright";
import { checkImageName } from "../../../naming";
import type { PageRecord } from "../../../types";
import { slugFromUrl } from "../../../url";
import type { ScanContext } from "../context";
import { fetchChain, pMap } from "../util";

interface ImgInfo {
  src: string;
  alt: string | null;
  role: string | null;
  naturalW: number;
  naturalH: number;
  renderW: number;
  renderH: number;
  loading: string;
  belowFold: boolean;
  hasDims: boolean;
  complete: boolean;
  bg: boolean;
  inPicture: boolean;
  objectFit: string;
}

/** Collects a site-wide hash index for duplicate detection across pages. */
export const imageHashes = new Map<string, Map<string, Set<string>>>(); // scanId -> hash -> urls

export async function imagesPage(ctx: ScanContext, p: PageRecord, page: Page) {
  const url = p.url;
  const base = { category: "images" as const, pageUrl: url };
  // Scroll through so lazy images load.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

  const imgs: ImgInfo[] = await page.evaluate(() => {
    const vh = window.innerHeight;
    const out: ImgInfo[] = [];
    document.querySelectorAll("img").forEach((img) => {
      const r = img.getBoundingClientRect();
      const s = getComputedStyle(img);
      out.push({
        src: img.currentSrc || img.src, alt: img.getAttribute("alt"), role: img.getAttribute("role") ?? (img.getAttribute("aria-hidden") === "true" ? "presentation" : null),
        naturalW: img.naturalWidth, naturalH: img.naturalHeight, renderW: Math.round(r.width), renderH: Math.round(r.height),
        loading: img.getAttribute("loading") ?? "", belowFold: r.top + window.scrollY > vh * 1.2, hasDims: img.hasAttribute("width") && img.hasAttribute("height"),
        complete: img.complete, bg: false, inPicture: img.parentElement?.tagName === "PICTURE", objectFit: s.objectFit,
      });
    });
    // CSS background images
    const seen = new Set<string>();
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg !== "none" ? /url\(["']?([^"')]+)["']?\)/.exec(bg) : null;
      if (m && !m[1].startsWith("data:") && !seen.has(m[1])) {
        seen.add(m[1]);
        const r = el.getBoundingClientRect();
        out.push({ src: new URL(m[1], location.href).href, alt: null, role: "presentation", naturalW: 0, naturalH: 0, renderW: Math.round(r.width), renderH: Math.round(r.height), loading: "", belowFold: false, hasDims: true, complete: true, bg: true, inPicture: false, objectFit: "" });
      }
    });
    return out;
  }) as ImgInfo[];

  const real = imgs.filter((i) => i.src && !i.src.startsWith("data:"));
  if (!real.length) {
    ctx.notTested({ ...base, checkKey: "img.present", title: "Images", description: "Image checks", reason: "No images on this page", severity: "Low" });
    return;
  }

  const unique = [...new Map(real.map((i) => [i.src, i])).values()].slice(0, ctx.full ? 120 : 40);
  const req = page.context().request;
  const fetched = await pMap(unique, 6, async (i) => {
    const r = await fetchChain(req, i.src, { readBody: false, method: "GET" });
    let hash: string | null = null;
    try {
      const resp = await req.get(r.finalUrl, { timeout: 15000 });
      const buf = await resp.body();
      hash = crypto.createHash("sha1").update(buf).digest("hex");
      r.bytes = buf.length || r.bytes;
    } catch {
      /* ignore */
    }
    return { i, r, hash };
  });

  const hashes = imageHashes.get(ctx.scanId) ?? imageHashes.set(ctx.scanId, new Map()).get(ctx.scanId)!;
  for (const f of fetched) if (f.hash) (hashes.get(f.hash) ?? hashes.set(f.hash, new Set()).get(f.hash)!).add(f.i.src);

  const broken = fetched.filter((f) => f.r.status === null || f.r.status >= 400 || (!f.i.bg && f.i.complete && f.i.naturalW === 0));
  ctx.check({ ...base, checkKey: "img.broken", title: "Broken / missing images", description: "Every image URL loads successfully", expected: "0 broken images", actual: broken.length ? broken.map((b) => `${b.r.status ?? b.r.error ?? "not decoded"} ${b.i.src}`).join("\n") : `${fetched.length} image(s) load`, severity: "High", recommendation: broken.length ? "Fix the image paths or re-upload missing files." : null }, broken.length === 0);

  const noAlt = real.filter((i) => !i.bg && i.alt === null && i.role !== "presentation");
  ctx.check({ ...base, checkKey: "img.alt", title: "Missing alt attributes", description: "Content images have alt text (decorative images use alt=\"\")", expected: "All <img> have alt", actual: noAlt.length ? noAlt.slice(0, 15).map((i) => i.src).join("\n") : "All images have alt", severity: "High", recommendation: noAlt.length ? 'Add descriptive alt text, or alt="" for decorative images.' : null }, noAlt.length === 0);

  const { imageMaxKb, imageWarnKb } = ctx.settings;
  const large = fetched.filter((f) => f.r.bytes > imageWarnKb * 1024);
  const tooLarge = large.filter((f) => f.r.bytes > imageMaxKb * 1024);
  ctx.check({ ...base, checkKey: "img.size", title: "Large image file sizes", description: `Images under ${imageWarnKb} KB (hard limit ${imageMaxKb} KB)`, expected: `≤ ${imageWarnKb} KB each`, actual: large.length ? large.sort((a, b) => b.r.bytes - a.r.bytes).slice(0, 15).map((f) => `${Math.round(f.r.bytes / 1024)} KB  ${f.i.src}`).join("\n") : "All images within budget", severity: tooLarge.length ? "High" : "Medium", recommendation: large.length ? "Compress images (e.g. Squoosh / sharp), serve WebP/AVIF and responsive srcset sizes." : null, meta: { total: fetched.reduce((s, f) => s + f.r.bytes, 0) } }, tooLarge.length ? false : large.length ? "warn" : true);

  const legacy = fetched.filter((f) => !/image\/(webp|avif|svg)/.test(f.r.contentType) && !/\.(webp|avif|svg)(\?|$)/i.test(f.i.src) && !f.i.inPicture && f.r.bytes > 10 * 1024);
  ctx.check({ ...base, checkKey: "img.modern-format", title: "WebP / AVIF usage", description: "Raster images are served in modern formats", expected: "WebP or AVIF (or <picture> fallback)", actual: legacy.length ? `${legacy.length}/${fetched.length} legacy format:\n${legacy.slice(0, 12).map((f) => `${f.r.contentType || "?"} ${f.i.src}`).join("\n")}` : "All modern formats", severity: "Medium", recommendation: legacy.length ? "Convert JPEG/PNG to WebP/AVIF; use <picture> for fallbacks." : null }, legacy.length === 0 ? true : legacy.length > fetched.length / 2 ? false : "warn");

  const notLazy = real.filter((i) => !i.bg && i.belowFold && i.loading !== "lazy");
  ctx.check({ ...base, checkKey: "img.lazy", title: "Lazy loading", description: "Below-the-fold images use loading=\"lazy\"", expected: "Off-screen images lazy-loaded", actual: notLazy.length ? `${notLazy.length} below-fold image(s) eager:\n${notLazy.slice(0, 10).map((i) => i.src).join("\n")}` : "OK", severity: "Low", recommendation: notLazy.length ? 'Add loading="lazy" decoding="async" to below-the-fold images (never the LCP image).' : null }, notLazy.length ? "warn" : true);

  const oversized = real.filter((i) => !i.bg && i.renderW > 0 && i.naturalW > i.renderW * 2.5 && i.naturalW > 600);
  ctx.check({ ...base, checkKey: "img.dimensions", title: "Incorrect image dimensions", description: "Intrinsic size is not far larger than the rendered size", expected: "Intrinsic width ≤ 2.5× rendered (for DPR)", actual: oversized.length ? oversized.slice(0, 12).map((i) => `${i.naturalW}×${i.naturalH} shown at ${i.renderW}×${i.renderH}  ${i.src}`).join("\n") : "OK", severity: "Medium", recommendation: oversized.length ? "Serve resized images with srcset/sizes matching the layout." : null }, oversized.length ? "warn" : true);

  const distorted = real.filter((i) => {
    if (i.bg || !i.naturalW || !i.renderW || !i.renderH || ["cover", "contain", "scale-down"].includes(i.objectFit)) return false;
    const a = i.naturalW / i.naturalH;
    const b = i.renderW / i.renderH;
    return Math.abs(a - b) / a > 0.05;
  });
  ctx.check({ ...base, checkKey: "img.aspect", title: "Incorrect image aspect ratio", description: "Images are not stretched or squashed", expected: "Rendered ratio within 5% of intrinsic (or object-fit used)", actual: distorted.length ? distorted.slice(0, 10).map((i) => `${i.naturalW}×${i.naturalH} → ${i.renderW}×${i.renderH}  ${i.src}`).join("\n") : "OK", severity: "Medium", recommendation: distorted.length ? "Keep width/height proportional or use object-fit: cover." : null }, distorted.length === 0);

  const noDims = real.filter((i) => !i.bg && !i.hasDims);
  ctx.check({ ...base, checkKey: "img.width-height", title: "Image width/height attributes", description: "Images reserve space to prevent layout shift (CLS)", expected: "width and height attributes on <img>", actual: noDims.length ? `${noDims.length} image(s) without width/height` : "OK", severity: "Low", recommendation: noDims.length ? "Add width/height attributes (or CSS aspect-ratio) to every image." : null }, noDims.length ? "warn" : true);

  const slug = slugFromUrl(url);
  const badNames = unique.filter((i) => !/\.svg(\?|$)/i.test(i.src)).map((i) => ({ i, n: checkImageName(i.src, slug) })).filter((x) => !x.n.ok);
  ctx.check({ ...base, checkKey: "img.naming", title: "Image naming convention", description: "Files follow page-name-section-image-description.webp", expected: "lowercase-kebab-case, descriptive, .webp", actual: badNames.length ? badNames.slice(0, 15).map((b) => `${b.n.fileName}: ${b.n.issues.join(", ")} → suggest ${b.n.suggestion}`).join("\n") : "All file names follow the convention", severity: "Low", recommendation: badNames.length ? "Rename images, e.g. homepage-main-banner.webp, about-us-company-overview.webp." : null, meta: { suggestions: badNames.slice(0, 50).map((b) => ({ file: b.n.fileName, suggestion: b.n.suggestion, issues: b.n.issues })) } }, badNames.length === 0 ? true : "warn");
}

export function imagesSite(ctx: ScanContext) {
  const hashes = imageHashes.get(ctx.scanId);
  if (!hashes) return;
  const dups = [...hashes.values()].filter((s) => s.size > 1).map((s) => [...s]);
  ctx.check({ category: "images", pageUrl: ctx.rootUrl, checkKey: "img.duplicates", title: "Duplicate image assets", description: "Identical image bytes served under different URLs", expected: "Each asset stored once", actual: dups.length ? dups.slice(0, 15).map((d) => d.join("\n   ≡ ")).join("\n") : "No duplicates", severity: "Low", recommendation: dups.length ? "Reuse a single asset URL so browsers cache it once." : null }, dups.length ? "warn" : true);
  imageHashes.delete(ctx.scanId);
}

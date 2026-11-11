import "server-only";
import type { Page } from "playwright";
import type { PageRecord } from "../../../types";
import { normalizeUrl } from "../../../url";
import type { ScanContext } from "../context";
import { fetchChain } from "../util";

export interface SeoData {
  title: string;
  description: string;
  h1: string[];
  headings: { level: number; text: string }[];
  canonical: string | null;
  canonicalCount: number;
  robots: string;
  og: Record<string, string>;
  twitter: Record<string, string>;
  favicon: string | null;
  jsonLd: string[];
  microdata: number;
  lang: string;
}

export async function extractSeo(page: Page): Promise<SeoData> {
  return page.evaluate(() => {
    const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content?.trim() ?? "";
    const og: Record<string, string> = {};
    document.querySelectorAll<HTMLMetaElement>('meta[property^="og:"]').forEach((m) => (og[m.getAttribute("property")!] = m.content));
    const twitter: Record<string, string> = {};
    document.querySelectorAll<HTMLMetaElement>('meta[name^="twitter:"]').forEach((m) => (twitter[m.name] = m.content));
    const canon = document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
    return {
      title: document.title.trim(),
      description: meta('meta[name="description"]'),
      h1: [...document.querySelectorAll("h1")].map((h) => (h.textContent ?? "").trim().replace(/\s+/g, " ")),
      headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").trim().slice(0, 80) })),
      canonical: canon[0]?.href ?? null,
      canonicalCount: canon.length,
      robots: meta('meta[name="robots"]') + " " + meta('meta[name="googlebot"]'),
      og,
      twitter,
      favicon: document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? null,
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ""),
      microdata: document.querySelectorAll("[itemscope]").length,
      lang: document.documentElement.lang,
    };
  });
}

const REQUIRED_SCHEMA: Record<string, string[]> = {
  Organization: ["name", "url"],
  LocalBusiness: ["name", "address"],
  WebSite: ["name", "url"],
  WebPage: ["name"],
  Article: ["headline", "datePublished"],
  NewsArticle: ["headline", "datePublished"],
  BlogPosting: ["headline", "datePublished"],
  BreadcrumbList: ["itemListElement"],
  Product: ["name"],
  FAQPage: ["mainEntity"],
  Event: ["name", "startDate", "location"],
  JobPosting: ["title", "datePosted", "hiringOrganization"],
};

export function validateJsonLd(blocks: string[]): { types: string[]; errors: string[] } {
  const types: string[] = [];
  const errors: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o["@graph"]) visit(o["@graph"]);
    const t = o["@type"];
    for (const type of (Array.isArray(t) ? t : t ? [t] : []) as string[]) {
      types.push(type);
      for (const req of REQUIRED_SCHEMA[type] ?? []) if (o[req] === undefined || o[req] === "") errors.push(`${type} is missing required property "${req}"`);
    }
  };
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const p of arr) if (p && typeof p === "object" && !("@context" in p) && !("@graph" in p)) errors.push("JSON-LD block is missing @context");
      visit(parsed);
    } catch (e) {
      errors.push(`Invalid JSON-LD: ${(e as Error).message}`);
    }
  }
  return { types, errors };
}

/** Per-page SEO checks. Returns extracted data so the site-wide pass can detect duplicates. */
export async function seoPage(ctx: ScanContext, p: PageRecord, page: Page): Promise<SeoData> {
  const d = await extractSeo(page);
  const url = p.url;
  const c = (o: Parameters<ScanContext["check"]>[0], ok: boolean | "warn") => ctx.check({ ...o, category: "seo", pageUrl: url }, ok);
  const base = { category: "seo" as const, pageUrl: url };

  c({ ...base, checkKey: "seo.title", title: "Page title", description: "<title> exists and is 10–60 characters", expected: "Title present, 10–60 chars", actual: d.title ? `"${d.title}" (${d.title.length} chars)` : "Missing", severity: d.title ? "Low" : "High", recommendation: "Write a unique, descriptive title of 50–60 characters including the primary keyword." }, !d.title ? false : d.title.length < 10 || d.title.length > 60 ? "warn" : true);
  c({ ...base, checkKey: "seo.description", title: "Meta description", description: "Meta description exists and is 70–160 characters", expected: "Description present, 70–160 chars", actual: d.description ? `${d.description.length} chars: "${d.description.slice(0, 160)}"` : "Missing", severity: d.description ? "Low" : "Medium", recommendation: "Add a compelling meta description of 120–160 characters." }, !d.description ? false : d.description.length < 70 || d.description.length > 160 ? "warn" : true);
  c({ ...base, checkKey: "seo.h1", title: "Single H1 heading", description: "Exactly one non-empty H1 per page", expected: "1 H1", actual: d.h1.length ? `${d.h1.length} H1: ${d.h1.map((h) => `"${h.slice(0, 60)}"`).join(", ")}` : "No H1", severity: d.h1.length === 0 ? "High" : "Medium", recommendation: "Use exactly one H1 that describes the page topic." }, d.h1.length === 1 && !!d.h1[0]);

  const skips: string[] = [];
  for (let i = 1; i < d.headings.length; i++) if (d.headings[i].level - d.headings[i - 1].level > 1) skips.push(`H${d.headings[i - 1].level} → H${d.headings[i].level} ("${d.headings[i].text}")`);
  const firstOk = !d.headings.length || d.headings[0].level === 1;
  c({ ...base, checkKey: "seo.heading-hierarchy", title: "Heading hierarchy", description: "Headings start at H1 and do not skip levels", expected: "Sequential heading levels", actual: skips.length || !firstOk ? [!firstOk ? `First heading is H${d.headings[0].level}` : "", ...skips.slice(0, 10)].filter(Boolean).join("\n") : `${d.headings.length} headings in order`, severity: "Low", recommendation: "Do not skip heading levels; style with CSS instead of choosing tags for size." }, skips.length || !firstOk ? "warn" : true);

  // canonical
  if (!d.canonical) c({ ...base, checkKey: "seo.canonical", title: "Canonical URL", description: "Page declares rel=canonical", expected: "Canonical link present", actual: "Missing", severity: "Medium", recommendation: 'Add <link rel="canonical" href="..."> pointing at the preferred URL.' }, false);
  else {
    const prod = ctx.options.productionBaseUrl;
    const canonNorm = safeNorm(d.canonical);
    const selfNorm = safeNorm(p.redirectTo ?? url);
    const matchesSelf = canonNorm === selfNorm || new URL(canonNorm).pathname === new URL(selfNorm).pathname;
    const issues: string[] = [];
    if (d.canonicalCount > 1) issues.push(`${d.canonicalCount} canonical tags`);
    if (!/^https:/.test(d.canonical)) issues.push("not HTTPS");
    if (prod && !d.canonical.startsWith(prod.replace(/\/$/, ""))) issues.push(`does not match production base ${prod}`);
    if (!matchesSelf) issues.push(`points to a different page (${d.canonical})`);
    c({ ...base, checkKey: "seo.canonical", title: "Canonical URL consistency", description: "Canonical is absolute, HTTPS, self-referencing and uses the production domain", expected: prod ? `Starts with ${prod} and matches page path` : "Self-referencing absolute HTTPS URL", actual: issues.length ? `${d.canonical} — ${issues.join("; ")}` : d.canonical, severity: prod && issues.some((i) => i.includes("production")) ? "High" : "Medium", recommendation: "Set the canonical to the production, HTTPS, self-referencing URL of this page." }, issues.length === 0 ? true : !matchesSelf || issues.some((i) => i.includes("production")) ? false : "warn");
  }

  // robots / noindex
  const noindex = /noindex/i.test(d.robots);
  c({ ...base, checkKey: "seo.noindex", title: "Robots meta / noindex", description: "Page is indexable (no unintended noindex)", expected: "No noindex on public pages", actual: d.robots.trim() || "No robots meta (indexable)", severity: "High", recommendation: noindex ? "Remove noindex before going live (common leftover from staging); keep it only on pages that must stay out of search (e.g. thank-you pages)." : null }, !noindex);

  // social
  const ogMissing = ["og:title", "og:description", "og:image"].filter((k) => !d.og[k]);
  c({ ...base, checkKey: "seo.open-graph", title: "Open Graph metadata", description: "og:title, og:description and og:image are present", expected: "All three present", actual: ogMissing.length ? `Missing: ${ogMissing.join(", ")}` : `og:title="${d.og["og:title"]}"`, severity: "Low", recommendation: "Add Open Graph tags so links render well when shared." }, ogMissing.length === 0 ? true : ogMissing.length === 3 ? false : "warn");
  if (d.og["og:image"]) {
    const r = await fetchChain(page.context().request, d.og["og:image"], { method: "HEAD", readBody: false });
    c({ ...base, checkKey: "seo.og-image", title: "OG image reachable", description: "og:image URL returns an image", expected: "HTTP 200 image", actual: `${r.status ?? r.error} ${r.contentType}`, severity: "Low", recommendation: "Use an absolute, publicly reachable 1200×630 image URL." }, r.status === 200 && /image/.test(r.contentType));
  }
  c({ ...base, checkKey: "seo.twitter-card", title: "Twitter card metadata", description: "twitter:card is declared", expected: "twitter:card present", actual: d.twitter["twitter:card"] ? `twitter:card=${d.twitter["twitter:card"]}` : "Missing", severity: "Low", recommendation: 'Add <meta name="twitter:card" content="summary_large_image">.' }, d.twitter["twitter:card"] ? true : "warn");
  c({ ...base, checkKey: "seo.lang", title: "Document language", description: "<html lang> is set", expected: "lang attribute present", actual: d.lang || "Missing", severity: "Low", recommendation: 'Set <html lang="en"> (or the correct language).' }, !!d.lang);

  // structured data
  if (d.jsonLd.length || d.microdata) {
    const v = validateJsonLd(d.jsonLd);
    c({ ...base, checkKey: "seo.structured-data", title: "Structured data validation", description: "JSON-LD parses and contains required properties for known schema.org types", expected: "Valid schema.org markup", actual: v.errors.length ? v.errors.join("\n") : `Types: ${v.types.join(", ") || `${d.microdata} microdata item(s)`}`, severity: "Medium", recommendation: v.errors.length ? "Fix the structured data errors; verify with Google's Rich Results Test." : null, meta: v }, v.errors.length === 0);
  } else c({ ...base, checkKey: "seo.structured-data", title: "Structured data", description: "Page includes schema.org structured data", expected: "At least Organization/WebSite schema on key pages", actual: "None found", severity: "Low", recommendation: "Add JSON-LD (Organization, WebSite, BreadcrumbList) to improve rich results." }, "warn");

  return d;
}

/** Site-wide SEO checks: duplicates, robots.txt, sitemap, favicon, https & www redirects. */
export async function seoSite(ctx: ScanContext, data: Map<string, SeoData>) {
  const root = ctx.rootUrl;
  const origin = new URL(root).origin;
  const bctx = await ctx.newContext();
  const req = bctx.request;
  const add = (o: Omit<Parameters<ScanContext["check"]>[0], "category">, ok: boolean | "warn") => ctx.check({ ...o, category: "seo" }, ok);
  try {
    for (const [field, label, sev] of [["title", "page titles", "Medium"], ["description", "meta descriptions", "Low"]] as const) {
      const groups = new Map<string, string[]>();
      for (const [u, d] of data) if (d[field]) groups.set(d[field], [...(groups.get(d[field]) ?? []), u]);
      const dups = [...groups.entries()].filter(([, v]) => v.length > 1);
      add({ checkKey: `seo.duplicate-${field}`, pageUrl: root, title: `Duplicate ${label}`, description: `Every page has a unique ${field}`, expected: "No duplicates", actual: dups.length ? dups.map(([t, v]) => `"${t.slice(0, 70)}" on ${v.length} pages:\n  ${v.join("\n  ")}`).join("\n") : `${data.size} page(s) checked, all unique`, severity: sev, recommendation: dups.length ? `Write a unique ${field} for each page.` : null }, dups.length === 0);
    }
    const missingMeta = [...data.entries()].filter(([, d]) => !d.title || !d.description).map(([u]) => u);
    add({ checkKey: "seo.missing-metadata", pageUrl: root, title: "Missing metadata (site-wide)", description: "Pages without title or meta description", expected: "0 pages", actual: missingMeta.length ? missingMeta.join("\n") : "None", severity: "Medium", recommendation: missingMeta.length ? "Add title and meta description to the listed pages." : null }, missingMeta.length === 0);

    const robots = await fetchChain(req, `${origin}/robots.txt`);
    const disallowAll = !!robots.body && /user-agent:\s*\*[\s\S]*?^disallow:\s*\/\s*$/im.test(robots.body);
    add({ checkKey: "seo.robots-txt", pageUrl: `${origin}/robots.txt`, title: "robots.txt", description: "robots.txt exists, does not block the whole site and references the sitemap", expected: "200, no 'Disallow: /' for *, Sitemap line", actual: robots.status !== 200 ? `HTTP ${robots.status ?? robots.error}` : `${disallowAll ? "Blocks all crawlers (Disallow: /). " : ""}${/sitemap:/i.test(robots.body ?? "") ? "Sitemap referenced" : "No Sitemap: line"}`, severity: disallowAll ? "Critical" : "Medium", recommendation: disallowAll ? "Remove 'Disallow: /' before production launch." : robots.status !== 200 ? "Publish a robots.txt." : null }, robots.status === 200 && !disallowAll ? (/sitemap:/i.test(robots.body ?? "") ? true : "warn") : false);

    const sm = await fetchChain(req, `${origin}/sitemap.xml`);
    add({ checkKey: "seo.sitemap", pageUrl: `${origin}/sitemap.xml`, title: "XML sitemap", description: "/sitemap.xml returns valid XML", expected: "200 with <urlset> or <sitemapindex>", actual: `HTTP ${sm.status ?? sm.error} ${sm.body && /<(urlset|sitemapindex)/.test(sm.body) ? "valid sitemap" : "not a sitemap"}`, severity: "Medium", recommendation: "Generate an XML sitemap and submit it to Search Console." }, sm.status === 200 && !!sm.body && /<(urlset|sitemapindex)/.test(sm.body));

    const anyFavicon = [...data.values()].find((d) => d.favicon)?.favicon ?? `${origin}/favicon.ico`;
    const fav = await fetchChain(req, anyFavicon, { method: "HEAD", readBody: false });
    add({ checkKey: "seo.favicon", pageUrl: root, title: "Favicon", description: "A favicon is declared and reachable", expected: "Favicon returns 200", actual: `${anyFavicon} → ${fav.status ?? fav.error}`, severity: "Low", recommendation: 'Add <link rel="icon" href="/favicon.ico"> plus an apple-touch-icon.' }, fav.status === 200);

    // HTTPS redirect
    const u = new URL(root);
    if (!["localhost", "127.0.0.1"].includes(u.hostname)) {
      const httpUrl = `http://${u.host}${u.pathname}`;
      const h = await fetchChain(req, httpUrl, { readBody: false });
      const toHttps = h.finalUrl.startsWith("https://");
      add({ checkKey: "seo.https-redirect", pageUrl: httpUrl, title: "HTTP → HTTPS redirect", description: "Plain HTTP permanently redirects to HTTPS", expected: "301/308 to https://", actual: h.chain.length ? h.chain.map((c) => `${c.status} ${c.url}`).join(" → ") + ` → ${h.finalUrl}` : `No redirect (HTTP ${h.status ?? h.error})`, severity: "High", recommendation: "Configure a 301 redirect from HTTP to HTTPS at the server/CDN." }, toHttps && h.chain.some((c) => c.status === 301 || c.status === 308) ? true : toHttps ? "warn" : false);

      // www vs non-www
      const isWww = u.hostname.startsWith("www.");
      const altHost = isWww ? u.hostname.slice(4) : `www.${u.hostname}`;
      const alt = await fetchChain(req, `https://${altHost}/`, { readBody: false });
      const canonicalHost = new URL(alt.finalUrl).hostname;
      const consolidated = alt.status === null || canonicalHost === u.hostname || (alt.chain.length > 0 && canonicalHost !== altHost);
      add({ checkKey: "seo.www", pageUrl: `https://${altHost}/`, title: "WWW vs non-WWW configuration", description: "The alternate host redirects to a single preferred host", expected: `https://${altHost}/ redirects to the preferred host`, actual: alt.status === null ? `Alternate host not reachable (${alt.error}) — OK if DNS not configured` : alt.chain.length ? `Redirects to ${alt.finalUrl}` : `Serves content directly (HTTP ${alt.status}) — duplicate host`, severity: "Medium", recommendation: consolidated ? null : "301-redirect the alternate host to the preferred host." }, consolidated);
    }
  } finally {
    await bctx.close();
  }
}

function safeNorm(u: string) {
  try {
    return normalizeUrl(u);
  } catch {
    return u;
  }
}

import "server-only";
import { insertLinks, listPages, upsertPage } from "../db";
import { duplicateKey, isCrawlableHref, normalizeUrl, sameSite } from "../../url";
import type { LinkRecord } from "../../types";
import type { ScanContext } from "./context";
import { extractHrefs, extractTitle, fetchChain, parseSitemap, pMap, type FetchResult } from "./util";

/**
 * Discovers pages: sitemap.xml (+ robots.txt Sitemap: entries), BFS link crawl, manual URLs.
 * Records internal/external links, broken links, redirects, duplicates and missing sitemap pages.
 */
export async function discover(ctx: ScanContext) {
  const { options, rootUrl } = ctx;
  const bctx = await ctx.newContext("chromium");
  const req = bctx.request;
  const origin = new URL(rootUrl).origin;
  const pageFetch = new Map<string, FetchResult>();
  const linkSources = new Map<string, Set<string>>(); // target -> from pages
  const queue: { url: string; depth: number; source: "seed" | "crawl" | "sitemap" | "manual" }[] = [];
  const seen = new Set<string>();
  const enqueue = (url: string, depth: number, source: (typeof queue)[number]["source"]) => {
    let n: string;
    try {
      n = normalizeUrl(url);
    } catch {
      return;
    }
    if (seen.has(n)) return;
    seen.add(n);
    queue.push({ url: n, depth, source });
  };

  try {
    ctx.progress(2, "Fetching homepage");
    enqueue(rootUrl, 0, "seed");
    for (const m of options.manualUrls) {
      try {
        enqueue(new URL(m, rootUrl).toString(), 1, "manual");
      } catch {
        ctx.log("warn", `Ignoring invalid manual URL: ${m}`);
      }
    }

    // ---- sitemap discovery ----
    const sitemapUrls: string[] = [];
    if (options.useSitemap) {
      ctx.progress(5, "Reading robots.txt and sitemap.xml");
      const robots = await fetchChain(req, `${origin}/robots.txt`);
      const candidates = new Set<string>([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]);
      if (robots.status === 200 && robots.body) for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.add(m[1]);
      const visited = new Set<string>();
      const stack = [...candidates];
      while (stack.length && visited.size < 25) {
        const sm = stack.shift()!;
        if (visited.has(sm)) continue;
        visited.add(sm);
        const r = await fetchChain(req, sm);
        if (r.status !== 200 || !r.body || !/<(urlset|sitemapindex)/i.test(r.body)) continue;
        const parsed = parseSitemap(r.body);
        stack.push(...parsed.sitemaps);
        sitemapUrls.push(...parsed.urls);
      }
      ctx.log("info", `Sitemap: ${sitemapUrls.length} URL(s) from ${visited.size} sitemap file(s)`);
      for (const u of sitemapUrls) if (sameSite(u, rootUrl) && isCrawlableHref(u)) enqueue(u, 1, "sitemap");
    }

    // ---- BFS crawl ----
    const limit = Math.max(1, options.maxPages);
    let processed = 0;
    while (queue.length && processed < limit && !ctx.cancelled) {
      const batch = queue.splice(0, Math.min(6, limit - processed));
      await pMap(batch, 6, async (item) => {
        const r = await fetchChain(req, item.url);
        pageFetch.set(item.url, r);
        const isHtml = /html/i.test(r.contentType);
        let links: string[] = [];
        if (r.body && isHtml) links = extractHrefs(r.body, r.finalUrl);
        // JS-rendered sites: fall back to a real browser for link extraction
        if (isHtml && links.length < 3 && r.status && r.status < 400) {
          try {
            const p = await bctx.newPage();
            await p.goto(item.url, { waitUntil: "networkidle", timeout: ctx.settings.pageTimeoutMs }).catch(() => {});
            links = await p.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
            await p.close();
          } catch {
            /* ignore */
          }
        }
        const finalSameSite = sameSite(r.finalUrl, rootUrl);
        upsertPage(ctx.scanId, {
          url: item.url,
          statusCode: r.status,
          redirectTo: r.chain.length ? r.finalUrl : null,
          contentType: r.contentType || null,
          title: r.body ? extractTitle(r.body) : null,
          depth: item.depth,
          source: item.source,
          selected: !!r.status && r.status < 400 && isHtml && finalSameSite,
          isInternal: true,
          error: r.error,
        });
        for (const l of links) {
          let n: string;
          try {
            n = normalizeUrl(l);
          } catch {
            continue;
          }
          (linkSources.get(n) ?? linkSources.set(n, new Set()).get(n)!).add(item.url);
          if (sameSite(n, rootUrl) && isCrawlableHref(n) && item.depth + 1 <= options.maxDepth) enqueue(n, item.depth + 1, "crawl");
        }
      });
      processed += batch.length;
      ctx.progress(8 + (processed / limit) * 60, `Crawling pages (${processed}/${limit})`);
    }
    if (queue.length) ctx.log("info", `Page limit reached (${limit}); ${queue.length} discovered URL(s) not crawled`);

    // ---- link checking ----
    const targets = [...linkSources.keys()].filter((u) => !pageFetch.has(u));
    const internalAssets = targets.filter((u) => sameSite(u, rootUrl));
    const external = targets.filter((u) => !sameSite(u, rootUrl)).slice(0, ctx.full ? 400 : 120);
    const toCheck = [...internalAssets.slice(0, 400), ...external];
    let checked = 0;
    const linkStatus = new Map<string, FetchResult>(pageFetch);
    await pMap(toCheck, 8, async (u) => {
      const r = await fetchChain(req, u, { method: "HEAD", readBody: false, timeout: 15000 });
      linkStatus.set(u, r);
      if (++checked % 10 === 0) ctx.progress(68 + (checked / toCheck.length) * 25, `Checking links (${checked}/${toCheck.length})`);
    });

    const linkRecords: LinkRecord[] = [];
    for (const [to, froms] of linkSources) {
      const r = linkStatus.get(to);
      for (const from of froms) {
        linkRecords.push({
          fromUrl: from,
          toUrl: to,
          statusCode: r?.status ?? null,
          kind: sameSite(to, rootUrl) ? "internal" : "external",
          redirectedTo: r && r.chain.length ? r.finalUrl : null,
          error: r ? r.error : "Not checked (limit reached)",
        });
      }
    }
    insertLinks(ctx.scanId, linkRecords);

    // ---- crawl results ----
    ctx.progress(95, "Analysing crawl results");
    recordCrawlFindings(ctx, linkStatus, linkSources, sitemapUrls, options.useSitemap);
  } finally {
    await bctx.close();
  }
}

function recordCrawlFindings(ctx: ScanContext, status: Map<string, FetchResult>, sources: Map<string, Set<string>>, sitemapUrls: string[], usedSitemap: boolean) {
  const root = ctx.rootUrl;
  const internalBroken: string[] = [];
  for (const [url, r] of status) {
    const internal = sameSite(url, root);
    const from = [...(sources.get(url) ?? [])].slice(0, 5);
    const broken = r.status === null || r.status >= 400;
    if (broken) {
      if (internal) internalBroken.push(url);
      // Many external sites block bots (403/429/999) — warn instead of fail.
      const botBlocked = !internal && r.status !== null && [401, 403, 405, 429, 999].includes(r.status);
      ctx.add({
        checkKey: internal ? "crawl.broken-internal" : "crawl.broken-external",
        category: "crawl",
        pageUrl: from[0] ?? url,
        title: internal ? "Broken internal link" : "Broken external link",
        description: `Link to ${url}`,
        expected: "Link responds with HTTP 2xx/3xx",
        actual: r.status ? `HTTP ${r.status}` : `Request failed: ${r.error}`,
        status: botBlocked ? "WARNING" : "FAIL",
        severity: internal ? (url === normalizeUrl(root) ? "Critical" : "High") : "Medium",
        error: r.error,
        recommendation: internal ? "Fix or remove the link, or add a 301 redirect to the correct page." : botBlocked ? "The remote site may block automated clients; verify manually." : "Update or remove the outdated external link.",
        meta: { target: url, linkedFrom: from },
      });
    }
    if (r.chain.length) {
      const external = !sameSite(r.finalUrl, url);
      const temp = r.chain.some((c) => c.status === 302 || c.status === 307);
      if (internal && (r.chain.length > 1 || temp || external)) {
        ctx.add({
          checkKey: "crawl.redirect",
          category: "crawl",
          pageUrl: from[0] ?? url,
          title: r.chain.length > 1 ? "Redirect chain detected" : external ? "Unexpected cross-domain redirect" : "Temporary redirect on internal URL",
          description: `${url} redirects`,
          expected: "Internal links point directly at the final URL (no chains, permanent 301 if needed)",
          actual: [...r.chain.map((c) => `${c.status} ${c.url}`), `→ ${r.finalUrl}`].join("\n"),
          status: external ? "FAIL" : "WARNING",
          severity: external ? "High" : "Low",
          recommendation: "Update links to the final destination; use a single 301 for moved content.",
          meta: { chain: r.chain, final: r.finalUrl },
        });
      }
    }
  }
  ctx.check(
    { checkKey: "crawl.broken-summary", category: "crawl", pageUrl: root, title: "No broken internal links", description: "All crawled internal URLs respond successfully", expected: "0 broken internal links", actual: `${internalBroken.length} broken internal link(s)`, severity: "High", recommendation: internalBroken.length ? "Fix the broken links listed in this report." : null },
    internalBroken.length === 0,
  );

  // duplicates
  const pages = listPages(ctx.scanId);
  const dupes = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.statusCode || p.statusCode >= 400) continue;
    const k = duplicateKey(p.redirectTo ?? p.url);
    dupes.set(k, [...(dupes.get(k) ?? []), p.url]);
  }
  const dupGroups = [...dupes.values()].filter((v) => v.length > 1);
  ctx.check(
    { checkKey: "crawl.duplicates", category: "crawl", pageUrl: root, title: "Duplicate URLs", description: "URLs that differ only by case, trailing slash, index file or www and serve the same content", expected: "Each page reachable at a single canonical URL", actual: dupGroups.length ? dupGroups.map((g) => g.join("  ≡  ")).join("\n") : "No duplicate URL variants found", severity: "Medium", recommendation: dupGroups.length ? "301-redirect duplicate variants to one canonical URL and set rel=canonical." : null, meta: { groups: dupGroups } },
    dupGroups.length ? "warn" : true,
  );

  // sitemap & missing pages
  if (usedSitemap) {
    ctx.check(
      { checkKey: "crawl.sitemap", category: "crawl", pageUrl: `${new URL(root).origin}/sitemap.xml`, title: "XML sitemap available", description: "sitemap.xml (or robots.txt Sitemap:) lists site URLs", expected: "Sitemap found with URLs", actual: sitemapUrls.length ? `${sitemapUrls.length} URL(s) listed` : "No sitemap found", severity: "Medium", recommendation: sitemapUrls.length ? null : "Publish /sitemap.xml and reference it from robots.txt." },
      sitemapUrls.length > 0,
    );
    const missing = sitemapUrls.filter((u) => {
      const r = status.get(safeNorm(u));
      return r && r.status !== null && r.status >= 400;
    });
    if (sitemapUrls.length)
      ctx.check(
        { checkKey: "crawl.missing-pages", category: "crawl", pageUrl: root, title: "Sitemap pages exist", description: "Every URL listed in the sitemap resolves", expected: "All sitemap URLs return 200", actual: missing.length ? `Missing: \n${missing.slice(0, 20).join("\n")}` : "All checked sitemap URLs resolve", severity: "High", recommendation: missing.length ? "Remove deleted pages from the sitemap or restore them." : null },
        missing.length === 0,
      );
    const crawled = new Set(pages.filter((p) => p.source === "crawl").map((p) => p.url));
    const orphanCount = pages.filter((p) => p.source === "crawl" && !sitemapUrls.map(safeNorm).includes(p.url)).length;
    if (sitemapUrls.length && crawled.size)
      ctx.check(
        { checkKey: "crawl.sitemap-coverage", category: "crawl", pageUrl: root, title: "Sitemap covers crawled pages", description: "Pages found by following links are listed in the sitemap", expected: "All crawlable pages in sitemap", actual: `${orphanCount} crawled page(s) not in sitemap`, severity: "Low", recommendation: orphanCount ? "Add missing pages to the sitemap." : null },
        orphanCount === 0 ? true : "warn",
      );
  }
}

function safeNorm(u: string) {
  try {
    return normalizeUrl(u);
  } catch {
    return u;
  }
}

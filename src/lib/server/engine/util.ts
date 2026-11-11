import "server-only";
import type { APIRequestContext } from "playwright";

export async function pMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface FetchResult {
  url: string;
  status: number | null;
  finalUrl: string;
  chain: { url: string; status: number }[];
  headers: Record<string, string>;
  body: string | null;
  contentType: string;
  bytes: number;
  error: string | null;
  ms: number;
}

/** Fetches a URL following redirects manually so each hop is recorded. */
export async function fetchChain(req: APIRequestContext, url: string, opts: { method?: "GET" | "HEAD"; readBody?: boolean; timeout?: number } = {}): Promise<FetchResult> {
  const chain: { url: string; status: number }[] = [];
  let current = url;
  const t0 = Date.now();
  for (let hop = 0; hop < 10; hop++) {
    try {
      let resp = await req.fetch(current, { method: opts.method ?? "GET", maxRedirects: 0, timeout: opts.timeout ?? 20000, failOnStatusCode: false });
      // Some servers reject HEAD
      if (opts.method === "HEAD" && [403, 405, 501].includes(resp.status())) {
        resp = await req.fetch(current, { method: "GET", maxRedirects: 0, timeout: opts.timeout ?? 20000, failOnStatusCode: false });
      }
      const status = resp.status();
      const headers = resp.headers();
      if (status >= 300 && status < 400 && headers["location"]) {
        chain.push({ url: current, status });
        current = new URL(headers["location"], current).toString();
        continue;
      }
      const contentType = headers["content-type"] ?? "";
      let body: string | null = null;
      let bytes = Number(headers["content-length"] ?? 0);
      if (opts.readBody !== false && opts.method !== "HEAD") {
        const buf = await resp.body().catch(() => Buffer.alloc(0));
        bytes = buf.length || bytes;
        if (/text|html|xml|json|javascript/i.test(contentType) || !contentType) body = buf.toString("utf8");
      }
      return { url, status, finalUrl: current, chain, headers, body, contentType, bytes, error: null, ms: Date.now() - t0 };
    } catch (e) {
      return { url, status: null, finalUrl: current, chain, headers: {}, body: null, contentType: "", bytes: 0, error: (e as Error).message.split("\n")[0], ms: Date.now() - t0 };
    }
  }
  return { url, status: null, finalUrl: current, chain, headers: {}, body: null, contentType: "", bytes: 0, error: "Too many redirects (>10)", ms: Date.now() - t0 };
}

export function extractHrefs(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || /^(mailto:|tel:|javascript:|#|data:|sms:)/i.test(raw)) continue;
    try {
      out.add(new URL(raw.replace(/&amp;/g, "&"), base).toString());
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 300) : null;
}

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = (tag: string) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>`, "gi"))].map((m) => m[1].replace(/&amp;/g, "&"));
  return { urls: locs("url"), sitemaps: locs("sitemap") };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

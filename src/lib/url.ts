// Pure URL helpers (unit tested).

export function validateUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "URL is required" };
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^[^:]+:\d+/.test(candidate)) {
      return { ok: false, error: "Only http and https URLs are supported" };
    }
    // Local dev servers rarely serve TLS; public hosts default to https.
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.(localhost|test))(:\d+)?(\/|$)/i.test(candidate);
    candidate = `${local ? "http" : "https"}://${candidate}`;
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
  if (!["http:", "https:"].includes(u.protocol)) return { ok: false, error: "Only http and https URLs are supported" };
  const host = u.hostname;
  const isLocal = host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith(".localhost") || host.endsWith(".test");
  if (!isLocal && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return { ok: false, error: "Hostname looks invalid" };
  return { ok: true, url: normalizeUrl(u.toString()) };
}

/** Normalises a URL for de-duplication: drops hash, default ports, sorts query, trims trailing slash (except root). */
export function normalizeUrl(input: string, base?: string): string {
  const u = new URL(input, base);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  // drop common tracking params
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_eid$|_ga$)/i.test(k)) u.searchParams.delete(k);
  }
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

/** Key used to find duplicate URLs that differ only by case / trailing slash / index file / www. */
export function duplicateKey(input: string): string {
  const u = new URL(input);
  let path = u.pathname.toLowerCase().replace(/\/(index|default)\.(html?|php|aspx?)$/, "/");
  path = path.replace(/\/+$/, "") || "/";
  const host = u.hostname.replace(/^www\./, "");
  return `${host}${path}${u.search}`;
}

export function sameSite(a: string, b: string): boolean {
  const ha = new URL(a).hostname.replace(/^www\./, "");
  const hb = new URL(b).hostname.replace(/^www\./, "");
  return ha === hb;
}

const SKIP_EXT = /\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|wav|css|js|json|xml|txt|woff2?|ttf|eot)$/i;
export function isCrawlableHref(href: string): boolean {
  if (!href) return false;
  if (/^(mailto:|tel:|javascript:|data:|#|sms:|whatsapp:)/i.test(href)) return false;
  try {
    const u = new URL(href);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    return !SKIP_EXT.test(u.pathname);
  } catch {
    return false;
  }
}

export const DOWNLOAD_EXT = /\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|csv)$/i;

export function slugFromUrl(url: string): string {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return (p || "home").slice(0, 60);
}

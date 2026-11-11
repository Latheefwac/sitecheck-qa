import "server-only";
import type { Page, Response } from "playwright";
import type { PageRecord } from "../../../types";
import { sameSite } from "../../../url";
import type { ScanContext } from "../context";
import { fetchChain } from "../util";

export interface NetworkCapture {
  consoleErrors: string[];
  pageErrors: string[];
  failed: { url: string; reason: string }[];
  badStatus: { url: string; status: number }[];
  requests: { url: string; type: string }[];
}

/** Attach listeners before navigation to capture console + network for the page. */
export function captureNetwork(page: Page): NetworkCapture {
  const cap: NetworkCapture = { consoleErrors: [], pageErrors: [], failed: [], badStatus: [], requests: [] };
  page.on("console", (m) => m.type() === "error" && cap.consoleErrors.push(m.text().slice(0, 400)));
  page.on("pageerror", (e) => cap.pageErrors.push(e.message.slice(0, 400)));
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText ?? "failed";
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) cap.failed.push({ url: r.url(), reason });
  });
  page.on("request", (r) => cap.requests.push({ url: r.url(), type: r.resourceType() }));
  page.on("response", (r: Response) => r.status() >= 400 && cap.badStatus.push({ url: r.url(), status: r.status() }));
  return cap;
}

const HEADERS: { name: string; severity: "High" | "Medium" | "Low"; fix: string; test?: (v: string) => boolean }[] = [
  { name: "strict-transport-security", severity: "High", fix: "Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.", test: (v) => /max-age=\d{7,}/.test(v) },
  { name: "content-security-policy", severity: "Medium", fix: "Define a Content-Security-Policy restricting script/style/frame sources." },
  { name: "x-content-type-options", severity: "Medium", fix: "Add `X-Content-Type-Options: nosniff`.", test: (v) => /nosniff/i.test(v) },
  { name: "referrer-policy", severity: "Low", fix: "Add `Referrer-Policy: strict-origin-when-cross-origin`." },
  { name: "permissions-policy", severity: "Low", fix: "Add a Permissions-Policy limiting camera, microphone, geolocation." },
];

const SECRET_PATTERNS: { name: string; re: RegExp; severity: "Critical" | "High" | "Medium" }[] = [
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/, severity: "Critical" },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: "Critical" },
  { name: "Stripe live secret key", re: /sk_live_[0-9a-zA-Z]{20,}/, severity: "Critical" },
  { name: "Slack token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/, severity: "High" },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{36}/, severity: "Critical" },
  { name: "reCAPTCHA / generic secret assignment", re: /(recaptcha[_-]?secret|secret[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, severity: "Critical" },
  { name: "Database connection string", re: /(mongodb(\+srv)?|postgres(ql)?|mysql):\/\/[^\s"'<>]+:[^\s"'<>@]+@/i, severity: "Critical" },
];

export async function securityPage(ctx: ScanContext, p: PageRecord, page: Page, cap: NetworkCapture, mainHeaders: Record<string, string>) {
  const url = p.url;
  const base = { category: "security" as const, pageUrl: url };
  const isHttps = url.startsWith("https://");
  ctx.check({ ...base, checkKey: "sec.https", title: "Served over HTTPS", description: "Page is delivered over TLS", expected: "https://", actual: url, severity: "Critical", recommendation: "Serve every page over HTTPS." }, isHttps || /localhost|127\.0\.0\.1/.test(url) ? true : false);

  if (isHttps) {
    const mixed = cap.requests.filter((r) => r.url.startsWith("http://"));
    ctx.check({ ...base, checkKey: "sec.mixed-content", title: "Mixed content", description: "No HTTP sub-resources on an HTTPS page", expected: "0 insecure requests", actual: mixed.length ? mixed.slice(0, 15).map((m) => `${m.type}: ${m.url}`).join("\n") : "None", severity: mixed.some((m) => ["script", "stylesheet", "xhr", "fetch"].includes(m.type)) ? "High" : "Medium", recommendation: mixed.length ? "Load every resource via https:// (or protocol-relative to the CDN)." : null }, mixed.length === 0);
  }

  // headers (only once per site to avoid noise: on root, plus pages whose headers differ is overkill)
  if (p.depth === 0) {
    for (const h of HEADERS) {
      const v = mainHeaders[h.name];
      const ok = !!v && (!h.test || h.test(v));
      if (h.name === "strict-transport-security" && !isHttps) continue;
      ctx.check({ ...base, checkKey: `sec.header.${h.name}`, title: `Security header: ${h.name}`, description: `Response sets ${h.name}`, expected: "Header present and valid", actual: v ? v.slice(0, 200) : "Missing", severity: h.severity, recommendation: ok ? null : h.fix }, ok ? true : h.severity === "Low" ? "warn" : false);
    }
    const frameOk = !!mainHeaders["x-frame-options"] || /frame-ancestors/i.test(mainHeaders["content-security-policy"] ?? "");
    ctx.check({ ...base, checkKey: "sec.header.clickjacking", title: "Clickjacking protection", description: "X-Frame-Options or CSP frame-ancestors is set", expected: "Present", actual: mainHeaders["x-frame-options"] ?? (frameOk ? "CSP frame-ancestors" : "Missing"), severity: "Medium", recommendation: frameOk ? null : "Add `X-Frame-Options: SAMEORIGIN` or CSP `frame-ancestors 'self'`." }, frameOk);
    const leaky = ["server", "x-powered-by", "x-aspnet-version"].filter((k) => mainHeaders[k] && /\d/.test(mainHeaders[k]));
    ctx.check({ ...base, checkKey: "sec.header.disclosure", title: "Server version disclosure", description: "Headers do not reveal software versions", expected: "No version numbers in Server / X-Powered-By", actual: leaky.length ? leaky.map((k) => `${k}: ${mainHeaders[k]}`).join("\n") : "No version disclosure", severity: "Low", recommendation: leaky.length ? "Hide server version banners." : null }, leaky.length ? "warn" : true);
  }

  // sensitive info in rendered HTML / inline scripts
  const html = await page.content();
  const found = SECRET_PATTERNS.filter((s) => s.re.test(html));
  ctx.check({ ...base, checkKey: "sec.exposed-secrets", title: "Exposed sensitive information", description: "Page source contains no API secrets, private keys or connection strings", expected: "None found", actual: found.length ? `Found: ${found.map((f) => f.name).join(", ")} (values redacted)` : "None found", severity: found[0]?.severity ?? "Critical", recommendation: found.length ? "Remove secrets from client code immediately and rotate them." : null }, found.length === 0);

  // insecure external resources
  const thirdPartyScripts = await page.$$eval("script[src]", (ss) => ss.map((s) => ({ src: (s as HTMLScriptElement).src, sri: !!(s as HTMLScriptElement).integrity })));
  const noSri = thirdPartyScripts.filter((s) => !sameSite(s.src, url) && !/googletagmanager|google-analytics|gstatic|recaptcha|google\.com/.test(s.src) && !s.sri);
  ctx.check({ ...base, checkKey: "sec.sri", title: "Third-party scripts integrity", description: "Static third-party scripts use Subresource Integrity", expected: "integrity attribute on static CDN scripts", actual: noSri.length ? noSri.slice(0, 10).map((s) => s.src).join("\n") : "OK", severity: "Low", recommendation: noSri.length ? "Add integrity + crossorigin attributes to version-pinned CDN scripts." : null }, noSri.length ? "warn" : true);

  // console & network
  const errs = [...cap.pageErrors.map((e) => `Uncaught: ${e}`), ...cap.consoleErrors];
  ctx.check({ ...base, checkKey: "sec.console-errors", title: "JavaScript console errors", description: "No uncaught exceptions or console.error output", expected: "0 errors", actual: errs.length ? errs.slice(0, 10).join("\n") : "No errors", severity: cap.pageErrors.length ? "High" : "Medium", recommendation: errs.length ? "Fix the JavaScript errors listed; they may break functionality." : null }, errs.length === 0);
  const failedReq = [...cap.failed.map((f) => `${f.reason}: ${f.url}`), ...cap.badStatus.map((b) => `HTTP ${b.status}: ${b.url}`)];
  ctx.check({ ...base, checkKey: "sec.failed-requests", title: "Failed network requests", description: "All sub-resource requests succeed", expected: "0 failed requests", actual: failedReq.length ? failedReq.slice(0, 15).join("\n") : "All requests succeeded", severity: "Medium", recommendation: failedReq.length ? "Fix missing assets / failing API calls." : null }, failedReq.length === 0);
}

/** Site-level: safe GETs for commonly exposed files. A hit is verified by content, not just status. */
export async function securitySite(ctx: ScanContext) {
  const origin = new URL(ctx.rootUrl).origin;
  const bctx = await ctx.newContext();
  const probes: { path: string; verify: (b: string) => boolean; sev: "Critical" | "High" | "Medium" }[] = [
    { path: "/.env", verify: (b) => /^[A-Z_][A-Z0-9_]*\s*=/m.test(b) && !/<html/i.test(b), sev: "Critical" },
    { path: "/.env.local", verify: (b) => /^[A-Z_][A-Z0-9_]*\s*=/m.test(b) && !/<html/i.test(b), sev: "Critical" },
    { path: "/.env.production", verify: (b) => /^[A-Z_][A-Z0-9_]*\s*=/m.test(b) && !/<html/i.test(b), sev: "Critical" },
    { path: "/.git/HEAD", verify: (b) => /^ref: refs\//.test(b.trim()), sev: "Critical" },
    { path: "/.git/config", verify: (b) => /\[core\]/.test(b), sev: "Critical" },
    { path: "/wp-config.php.bak", verify: (b) => /DB_PASSWORD/.test(b), sev: "Critical" },
    { path: "/.DS_Store", verify: (b) => b.includes("Bud1"), sev: "Medium" },
    { path: "/phpinfo.php", verify: (b) => /phpinfo\(\)|PHP Version/i.test(b), sev: "High" },
    { path: "/server-status", verify: (b) => /Apache Server Status/i.test(b), sev: "Medium" },
    { path: "/.npmrc", verify: (b) => /_authToken|registry=/.test(b) && !/<html/i.test(b), sev: "High" },
  ];
  try {
    for (const pr of probes) {
      const r = await fetchChain(bctx.request, origin + pr.path, { timeout: 10000 });
      const exposed = r.status === 200 && !r.chain.length && !!r.body && pr.verify(r.body);
      ctx.check({ category: "security", pageUrl: origin + pr.path, checkKey: `sec.exposed-file${pr.path}`, title: `Publicly accessible file: ${pr.path}`, description: `${pr.path} must not be downloadable`, expected: "403/404 or not served", actual: exposed ? `EXPOSED — HTTP 200 with matching content (${r.bytes} bytes)` : `Not exposed (HTTP ${r.status ?? r.error})`, severity: pr.sev, recommendation: exposed ? `Block access to ${pr.path} at the web server and rotate any credentials it contains.` : null }, !exposed);
    }
  } finally {
    await bctx.close();
  }
}

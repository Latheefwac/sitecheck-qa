/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped third-party globals (gsap, grecaptcha, dataLayer) inside page.evaluate */
import "server-only";
import type { Page } from "playwright";
import type { PageRecord } from "../../../types";
import type { ScanContext } from "../context";
import type { NetworkCapture } from "./security";
import { sleep } from "../util";

export async function integrationsPage(ctx: ScanContext, p: PageRecord, page: Page, cap: NetworkCapture) {
  const base = { category: "integrations" as const, pageUrl: p.url };
  const s = ctx.settings;
  const html = await page.content();

  // ---------- Google Tag Manager ----------
  const gtmScriptIds = [...html.matchAll(/googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/g)].map((m) => m[1]);
  const gtmInline = [...html.matchAll(/['"](GTM-[A-Z0-9]{4,})['"]/g)].map((m) => m[1]);
  const gtmIds = [...new Set([...gtmScriptIds, ...gtmInline])];
  const gtmRequests = cap.requests.filter((r) => /googletagmanager\.com\/gtm\.js/.test(r.url));
  const gtmRuntime = await page.evaluate(() => Object.keys((window as any).google_tag_manager ?? {}).filter((k) => k.startsWith("GTM-")));
  if (!gtmIds.length && !gtmRequests.length) {
    ctx.check({ ...base, checkKey: "int.gtm", title: "Google Tag Manager installed", description: "GTM container snippet present", expected: s.gtmContainerId ? `GTM ${s.gtmContainerId}` : "GTM container (if required)", actual: "Not detected", severity: s.gtmContainerId ? "High" : "Low", recommendation: "Add the GTM snippet in <head> and the <noscript> iframe after <body>." }, s.gtmContainerId ? false : "warn");
  } else {
    const validFormat = gtmIds.every((id) => /^GTM-[A-Z0-9]{6,8}$/.test(id));
    const matches = !s.gtmContainerId || gtmIds.includes(s.gtmContainerId);
    ctx.check({ ...base, checkKey: "int.gtm", title: "Google Tag Manager container ID", description: "GTM container ID is valid" + (s.gtmContainerId ? " and matches the expected container" : ""), expected: s.gtmContainerId || "GTM-XXXXXXX format", actual: gtmIds.join(", "), severity: "High", recommendation: matches && validFormat ? null : `Use the correct container ID${s.gtmContainerId ? ` (${s.gtmContainerId})` : ""}.` }, matches && validFormat);
    const dupLoads = gtmRequests.length;
    ctx.check({ ...base, checkKey: "int.gtm-duplicate", title: "Duplicate GTM scripts", description: "Each container loads exactly once", expected: "1 gtm.js load per container", actual: `${dupLoads} gtm.js request(s) for ${gtmScriptIds.length || gtmIds.length} container(s)`, severity: "Medium", recommendation: dupLoads > gtmIds.length ? "Remove the duplicate GTM snippet (often both theme and plugin inject it)." : null }, dupLoads <= Math.max(1, gtmIds.length));
    ctx.check({ ...base, checkKey: "int.gtm-loaded", title: "GTM script loads", description: "gtm.js downloaded and window.google_tag_manager initialised", expected: "Container initialised", actual: gtmRuntime.length ? `Initialised: ${gtmRuntime.join(", ")}` : gtmRequests.length ? "Requested but not initialised" : "Not requested (blocked/consent-gated?)", severity: "High", recommendation: gtmRuntime.length ? null : "Check CSP, consent mode gating and that the snippet is not commented out." }, gtmRuntime.length > 0 ? true : gtmRequests.length ? false : "warn");
    const noscript = /googletagmanager\.com\/ns\.html/.test(html);
    ctx.check({ ...base, checkKey: "int.gtm-noscript", title: "GTM noscript fallback", description: "<noscript> iframe is present", expected: "ns.html iframe", actual: noscript ? "Present" : "Missing", severity: "Low", recommendation: noscript ? null : "Add the GTM <noscript> iframe immediately after <body>." }, noscript ? true : "warn");
  }
  if (s.expectedDataLayerEvents.length) {
    await sleep(1500);
    const events = await page.evaluate(() => ((window as any).dataLayer ?? []).map((e: any) => e?.event ?? (e && e[0] === "event" ? e[1] : null)).filter(Boolean));
    const missing = s.expectedDataLayerEvents.filter((e) => !events.includes(e));
    ctx.check({ ...base, checkKey: "int.datalayer-events", title: "Expected tracking events", description: "Configured dataLayer events fire on page load", expected: s.expectedDataLayerEvents.join(", "), actual: `Fired: ${[...new Set(events)].join(", ") || "none"}${missing.length ? `\nMissing: ${missing.join(", ")}` : ""}`, severity: "Medium", recommendation: missing.length ? "Check GTM triggers or the dataLayer.push calls for the missing events (interaction events must be tested manually)." : null }, missing.length === 0 ? true : "warn");
  }

  // ---------- GA4 ----------
  const gaIds = [...new Set([...html.matchAll(/\b(G-[A-Z0-9]{6,12})\b/g)].map((m) => m[1]))];
  const gtagLoads = cap.requests.filter((r) => /googletagmanager\.com\/gtag\/js\?id=G-/.test(r.url));
  const collect = cap.requests.filter((r) => /google-analytics\.com\/(g\/)?collect|analytics\.google\.com\/g\/collect/.test(r.url));
  const pageViews = collect.filter((r) => /[?&]en=page_view/.test(r.url));
  const allIds = [...new Set([...gaIds, ...gtagLoads.map((r) => /id=(G-[A-Z0-9]+)/.exec(r.url)?.[1] ?? ""), ...collect.map((r) => /[?&]tid=(G-[A-Z0-9]+)/.exec(r.url)?.[1] ?? "")].filter(Boolean))];
  if (!allIds.length) ctx.check({ ...base, checkKey: "int.ga4", title: "Google Analytics 4 integration", description: "GA4 tag detected (directly or via GTM)", expected: s.ga4MeasurementId || "GA4 measurement ID", actual: "Not detected", severity: s.ga4MeasurementId ? "High" : "Low", recommendation: "Install GA4 via GTM or gtag.js." }, s.ga4MeasurementId ? false : "warn");
  else {
    const matches = !s.ga4MeasurementId || allIds.includes(s.ga4MeasurementId);
    ctx.check({ ...base, checkKey: "int.ga4", title: "GA4 measurement ID", description: "Measurement ID detected" + (s.ga4MeasurementId ? " and matches expected" : ""), expected: s.ga4MeasurementId || "G-XXXXXXXX", actual: allIds.join(", "), severity: "High", recommendation: matches ? null : `Replace with ${s.ga4MeasurementId}.` }, matches);
    ctx.check({ ...base, checkKey: "int.ga4-pageview", title: "GA4 page view tracking", description: "A page_view hit is sent to Google Analytics", expected: "≥ 1 page_view collect request", actual: `${pageViews.length} page_view hit(s), ${collect.length} collect request(s)`, severity: "High", recommendation: pageViews.length ? null : "Check that the GA4 config tag fires on All Pages and is not blocked by consent mode." }, pageViews.length ? true : "warn");
    const perId = new Map<string, number>();
    for (const r of pageViews) { const id = /[?&]tid=(G-[A-Z0-9]+)/.exec(r.url)?.[1] ?? "?"; perId.set(id, (perId.get(id) ?? 0) + 1); }
    const dup = [...perId.entries()].filter(([, n]) => n > 1);
    ctx.check({ ...base, checkKey: "int.ga4-duplicate", title: "Duplicate GA tracking", description: "Each property records one page_view per load", expected: "1 page_view per measurement ID", actual: dup.length ? dup.map(([id, n]) => `${id}: ${n} page_views`).join("\n") : `OK (${gtagLoads.length} gtag.js load(s))`, severity: "Medium", recommendation: dup.length ? "Remove the duplicate config (hard-coded gtag + GTM GA4 tag is the usual cause)." : null }, dup.length === 0);
  }

  // ---------- reCAPTCHA v3 ----------
  const siteKey = /recaptcha\/(?:api|enterprise)\.js\?[^"']*render=([A-Za-z0-9_-]{30,})/.exec(html)?.[1] ?? /data-sitekey=["']([A-Za-z0-9_-]{30,})/.exec(html)?.[1] ?? null;
  const rcLoaded = cap.requests.some((r) => /recaptcha\/(api|enterprise)\.js|recaptcha__/.test(r.url));
  if (!siteKey && !rcLoaded) return;
  const rcBase = { ...base, meta: { siteKey: siteKey ? `${siteKey.slice(0, 6)}…` : null } };
  const ready = await page.evaluate(() => typeof (window as any).grecaptcha?.execute === "function");
  ctx.check({ ...rcBase, checkKey: "int.recaptcha-script", title: "reCAPTCHA script loads", description: "api.js loads and grecaptcha is available", expected: "grecaptcha.execute available", actual: `Script requested: ${rcLoaded}; grecaptcha ready: ${ready}; v3 site key: ${siteKey ? "present" : "not found (v2 checkbox?)"}`, severity: "High", recommendation: ready ? null : "Check CSP allows www.google.com/www.gstatic.com and the script tag is present." }, ready);
  const leaked = /6L[A-Za-z0-9_-]{38}/g.test(html.replace(siteKey ?? "__none__", "")) && /secret/i.test(html);
  ctx.check({ ...rcBase, checkKey: "int.recaptcha-secret", title: "reCAPTCHA secret not exposed", description: "Secret key never appears client-side", expected: "Only the public site key in page source", actual: leaked ? "A second key next to the word 'secret' was found in the page source (value withheld)" : "No secret exposed", severity: "Critical", recommendation: leaked ? "Remove the secret from client code and rotate it in the reCAPTCHA admin console." : null }, !leaked);
  if (!siteKey || !ready) return;
  const tok = await page.evaluate(async (key) => {
    const g = (window as any).grecaptcha;
    try {
      await new Promise<void>((r) => g.ready(() => r()));
      const t: string = await Promise.race([g.execute(key, { action: "qa_test" }), new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
      return { ok: true, len: t?.length ?? 0, token: t, err: null as string | null };
    } catch (e) {
      return { ok: false, len: 0, token: "", err: String((e as Error)?.message ?? e) };
    }
  }, siteKey);
  ctx.check({ ...rcBase, checkKey: "int.recaptcha-token", title: "reCAPTCHA token generation", description: "grecaptcha.execute returns a token (also confirms the domain is allowed for this site key)", expected: "Token returned", actual: tok.ok ? `Token generated (${tok.len} chars)` : `Failed: ${tok.err} — the site key may not allow this domain`, severity: "High", recommendation: tok.ok ? null : "Add this domain to the site key's allowed domains in the reCAPTCHA admin console." }, tok.ok && tok.len > 20);

  const ep = s.recaptchaVerifyEndpoint;
  if (!ep) {
    for (const k of ["valid", "invalid", "expired"]) ctx.notTested({ ...rcBase, checkKey: `int.recaptcha-backend-${k}`, title: `reCAPTCHA backend validation (${k} token)`, description: "Server-side verification and score handling", reason: "No authorized test verification endpoint configured in Settings. The secret key is never used by this tool.", severity: "Medium" });
    return;
  }
  // Authorized test endpoint contract: POST { token, action } → { success: boolean, score?: number }
  const call = async (token: string) => {
    try {
      const r = await page.context().request.post(ep, { data: { token, action: "qa_test" }, timeout: 15000, failOnStatusCode: false });
      let j: { success?: boolean; score?: number } = {};
      try { j = await r.json(); } catch {}
      return { status: r.status(), success: j.success === true, score: j.score };
    } catch (e) {
      return { status: 0, success: false, score: undefined, err: (e as Error).message };
    }
  };
  const valid = tok.ok ? await call(tok.token) : null;
  if (valid) ctx.check({ ...rcBase, checkKey: "int.recaptcha-backend-valid", title: "reCAPTCHA backend validation (valid token)", description: "Test endpoint verifies a fresh token and returns a score", expected: "success: true with score 0.0–1.0", actual: `HTTP ${valid.status}; success=${valid.success}; score=${valid.score ?? "n/a"}`, severity: "High", recommendation: valid.success ? (typeof valid.score !== "number" ? "Return and act on the score (e.g. reject < 0.5)." : null) : "Check server-side verification against siteverify and the action name." }, valid.success ? (typeof valid.score === "number" ? true : "warn") : false);
  const invalid = await call("qa-invalid-token");
  ctx.check({ ...rcBase, checkKey: "int.recaptcha-backend-invalid", title: "reCAPTCHA backend validation (invalid token)", description: "A forged token is rejected", expected: "success: false / 4xx", actual: `HTTP ${invalid.status}; success=${invalid.success}`, severity: "Critical", recommendation: invalid.success ? "The backend accepts invalid tokens — verification is not enforced!" : null }, !invalid.success);
  if (tok.ok) {
    const replay = await call(tok.token); // tokens are single-use; a reused token behaves like an expired one
    ctx.check({ ...rcBase, checkKey: "int.recaptcha-backend-expired", title: "reCAPTCHA backend validation (reused/expired token)", description: "Re-submitting an already-verified token is rejected", expected: "success: false (timeout-or-duplicate)", actual: `HTTP ${replay.status}; success=${replay.success}`, severity: "High", recommendation: replay.success ? "Reject duplicate/expired tokens (Google returns timeout-or-duplicate)." : null }, !replay.success);
  }
}

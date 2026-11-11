import "server-only";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright";
import { DATA_DIR, addLog, insertResult, updateScan } from "../db";
import { redact } from "../secrets";
import type { AuthConfig, BrowserName, PageRecord, ScanOptions, Settings, TestResultInput } from "../../types";

/** Global event bus for real-time progress (consumed by the SSE route). */
const g = globalThis as unknown as { __qaBus?: EventEmitter };
export const bus: EventEmitter = (g.__qaBus ??= new EventEmitter().setMaxListeners(200));

export interface ScanEvent {
  type: "progress" | "log" | "result" | "status";
  scanId: string;
  progress?: number;
  phase?: string;
  level?: string;
  message?: string;
  status?: string;
}

export class ScanContext {
  readonly shotDir: string;
  private browsers = new Map<BrowserName, Browser>();
  cancelled = false;
  counts = { pass: 0, fail: 0, warning: 0, notTested: 0 };

  constructor(
    readonly scanId: string,
    readonly rootUrl: string,
    readonly options: ScanOptions,
    readonly settings: Settings,
    readonly auth: AuthConfig | null,
  ) {
    this.shotDir = path.join(DATA_DIR, "screenshots", scanId);
    fs.mkdirSync(this.shotDir, { recursive: true });
  }

  get full() {
    return this.options.mode === "full";
  }

  log(level: "info" | "warn" | "error", message: string) {
    const m = redact(message);
    addLog(this.scanId, level, m);
    bus.emit(`scan:${this.scanId}`, { type: "log", scanId: this.scanId, level, message: m } satisfies ScanEvent);
  }

  progress(progress: number, phase: string) {
    const p = Math.max(0, Math.min(100, Math.round(progress * 10) / 10));
    updateScan(this.scanId, { progress: p, phase });
    bus.emit(`scan:${this.scanId}`, { type: "progress", scanId: this.scanId, progress: p, phase } satisfies ScanEvent);
  }

  add(r: TestResultInput) {
    const clean: TestResultInput = {
      ...r,
      actual: redact(String(r.actual).slice(0, 4000)),
      error: r.error ? redact(String(r.error).slice(0, 4000)) : null,
    };
    insertResult(this.scanId, clean);
    const k = r.status === "PASS" ? "pass" : r.status === "FAIL" ? "fail" : r.status === "WARNING" ? "warning" : "notTested";
    this.counts[k]++;
    bus.emit(`scan:${this.scanId}`, { type: "result", scanId: this.scanId, status: r.status } satisfies ScanEvent);
  }

  /** Records a check whose outcome is boolean-ish, with fail severity applied only when failing. */
  check(
    base: Omit<TestResultInput, "status" | "actual"> & { actual: string },
    ok: boolean | "warn",
  ) {
    this.add({ ...base, status: ok === true ? "PASS" : ok === "warn" ? "WARNING" : "FAIL" });
  }

  notTested(base: Omit<TestResultInput, "status" | "actual" | "expected"> & { reason: string; expected?: string }) {
    const { reason, ...rest } = base;
    this.add({ ...rest, expected: base.expected ?? "Check executed", actual: reason, status: "NOT_TESTED" });
  }

  async browser(name: BrowserName = "chromium"): Promise<Browser> {
    const existing = this.browsers.get(name);
    if (existing?.isConnected()) return existing;
    let b: Browser;
    if (name === "firefox") b = await firefox.launch();
    else if (name === "webkit") b = await webkit.launch();
    else if (name === "msedge") b = await chromium.launch({ channel: "msedge" });
    else b = await chromium.launch();
    this.browsers.set(name, b);
    return b;
  }

  contextOptions(extra: BrowserContextOptions = {}): BrowserContextOptions {
    const o: BrowserContextOptions = { ignoreHTTPSErrors: false, ...extra };
    const a = this.auth;
    if (a?.type === "basic" && a.username) o.httpCredentials = { username: a.username, password: a.password ?? "" };
    const headers: Record<string, string> = { ...(a?.headers ?? {}) };
    if (a?.type === "cookie" && a.cookie) headers["Cookie"] = a.cookie;
    if (Object.keys(headers).length) o.extraHTTPHeaders = headers;
    return o;
  }

  private loginState: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

  /** Auth as plain HTTP headers (for Lighthouse, which runs in its own Chrome). */
  async authHeaders(): Promise<Record<string, string>> {
    const a = this.auth;
    const h: Record<string, string> = { ...(a?.headers ?? {}) };
    if (a?.type === "basic" && a.username) h["Authorization"] = `Basic ${Buffer.from(`${a.username}:${a.password ?? ""}`).toString("base64")}`;
    const cookies: string[] = [];
    if (a?.type === "cookie" && a.cookie) cookies.push(a.cookie);
    if (a?.type === "form") {
      if (!this.loginState) await (await this.newContext()).close();
      const host = new URL(this.rootUrl).hostname;
      for (const c of this.loginState?.cookies ?? []) if (host.endsWith(c.domain.replace(/^\./, ""))) cookies.push(`${c.name}=${c.value}`);
    }
    if (cookies.length) h["Cookie"] = cookies.join("; ");
    return h;
  }

  /** New browser context with auth applied (performs form login once, then reuses storage state). */
  async newContext(name: BrowserName = "chromium", extra: BrowserContextOptions = {}): Promise<BrowserContext> {
    const b = await this.browser(name);
    if (this.auth?.type === "form" && !this.loginState) {
      const c = await b.newContext(this.contextOptions());
      const p = await c.newPage();
      try {
        await p.goto(this.auth.loginUrl || this.rootUrl, { waitUntil: "domcontentloaded", timeout: this.settings.pageTimeoutMs });
        await p.fill(this.auth.usernameSelector || "input[type=email], input[name*=user i], input[name*=email i]", this.auth.username ?? "");
        await p.fill(this.auth.passwordSelector || "input[type=password]", this.auth.password ?? "");
        await Promise.all([
          p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
          p.click(this.auth.submitSelector || "button[type=submit], input[type=submit]"),
        ]);
        this.loginState = await c.storageState();
        this.log("info", "Form login completed for authenticated scan");
      } catch (e) {
        this.log("error", `Form login failed: ${(e as Error).message}`);
      } finally {
        await c.close();
      }
    }
    const ctx = await b.newContext({ ...this.contextOptions(extra), ...(this.loginState ? { storageState: this.loginState } : {}) });
    ctx.setDefaultTimeout(this.settings.pageTimeoutMs);
    return ctx;
  }

  /** Opens a page and navigates; returns null + records a failure if navigation fails. */
  async openPage(url: string, opts: { browser?: BrowserName; context?: BrowserContextOptions; waitUntil?: "load" | "networkidle" | "domcontentloaded" } = {}) {
    const ctx = await this.newContext(opts.browser, opts.context);
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: opts.waitUntil ?? "load", timeout: this.settings.pageTimeoutMs });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return { ctx, page, resp };
    } catch (e) {
      await ctx.close();
      throw e;
    }
  }

  /** Saves a screenshot under data/screenshots/<scan>/ and returns the path relative to DATA_DIR. */
  async shot(page: Page, name: string, opts: { fullPage?: boolean; type?: "png" | "jpeg"; maxHeight?: number } = {}): Promise<string | null> {
    try {
      const type = opts.type ?? "jpeg";
      const file = `${name.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 120)}-${Date.now().toString(36)}.${type === "png" ? "png" : "jpg"}`;
      const abs = path.join(this.shotDir, file);
      let clip;
      if (opts.fullPage && opts.maxHeight) {
        const vp = page.viewportSize();
        const h = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
        if (vp && h > opts.maxHeight) clip = { x: 0, y: 0, width: vp.width, height: opts.maxHeight };
      }
      await page.screenshot({ path: abs, fullPage: opts.fullPage ?? false, type, quality: type === "jpeg" ? 70 : undefined, clip, timeout: 20000, animations: "disabled" });
      return path.relative(DATA_DIR, abs);
    } catch {
      return null;
    }
  }

  async close() {
    for (const b of this.browsers.values()) await b.close().catch(() => {});
    this.browsers.clear();
  }
}

export type PageList = PageRecord[];

/** Helper: run fn per page, isolating failures so one page cannot abort the scan. */
export async function forEachPage(ctx: ScanContext, pages: PageRecord[], label: string, base: number, span: number, fn: (p: PageRecord, i: number) => Promise<void>) {
  for (let i = 0; i < pages.length; i++) {
    if (ctx.cancelled) return;
    const p = pages[i];
    ctx.progress(base + (span * i) / Math.max(1, pages.length), `${label}: ${new URL(p.url).pathname}`);
    try {
      await fn(p, i);
    } catch (e) {
      ctx.log("error", `${label} failed on ${p.url}: ${(e as Error).message}`);
    }
  }
}

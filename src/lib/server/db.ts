import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import { levelOf } from "../a11y-levels";
import { categoriesOf } from "../test-categories";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  type LinkRecord,
  type BugStatus,
  type PageRecord,
  type Project,
  type Scan,
  type ScanOptions,
  type ScreenshotRecord,
  type Settings,
  type TestResult,
  type TestResultInput,
} from "../types";

export const DATA_DIR = process.env.QA_DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const g = globalThis as unknown as { __qaDb?: Database.Database };

function open(): Database.Database {
  const db = new Database(path.join(DATA_DIR, "qa.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
  CREATE TABLE IF NOT EXISTS websites (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY, website_id INTEGER NOT NULL REFERENCES websites(id), url TEXT NOT NULL, mode TEXT NOT NULL,
    status TEXT NOT NULL, phase TEXT, progress REAL NOT NULL DEFAULT 0, options_json TEXT NOT NULL, auth_enc TEXT,
    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, scores_json TEXT, summary_json TEXT, error TEXT, baseline_scan_id TEXT
  );
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, url TEXT NOT NULL,
    status_code INTEGER, redirect_to TEXT, content_type TEXT, title TEXT, depth INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL,
    selected INTEGER NOT NULL DEFAULT 1, is_internal INTEGER NOT NULL DEFAULT 1, error TEXT, UNIQUE(scan_id, url)
  );
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, from_url TEXT NOT NULL,
    to_url TEXT NOT NULL, status_code INTEGER, kind TEXT NOT NULL, redirected_to TEXT, error TEXT
  );
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, case_id TEXT NOT NULL,
    check_key TEXT NOT NULL, category TEXT NOT NULL, page_url TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
    expected TEXT NOT NULL, actual TEXT NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL, screenshot TEXT, error TEXT,
    recommendation TEXT, viewport TEXT, browser TEXT, meta_json TEXT, created_at TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0, assignee TEXT, comment TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_results_scan ON results(scan_id);
  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, page_url TEXT NOT NULL,
    viewport TEXT NOT NULL, browser TEXT NOT NULL, path TEXT NOT NULL, diff_path TEXT, diff_ratio REAL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, ts TEXT NOT NULL,
    level TEXT NOT NULL, message TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY, website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE, label TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL, token_enc TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS result_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE, ts TEXT NOT NULL,
    actor TEXT NOT NULL, via TEXT NOT NULL, from_status TEXT, to_status TEXT, note TEXT
  );
  `);
  // Additive migrations for databases created before the developer bug workflow existed.
  const cols = new Set((db.prepare("PRAGMA table_info(results)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("bug_status")) db.exec("ALTER TABLE results ADD COLUMN bug_status TEXT NOT NULL DEFAULT 'open'");
  if (!cols.has("dev_comment")) db.exec("ALTER TABLE results ADD COLUMN dev_comment TEXT");
  if (!cols.has("status_by")) db.exec("ALTER TABLE results ADD COLUMN status_by TEXT");
  if (!cols.has("status_at")) db.exec("ALTER TABLE results ADD COLUMN status_at TEXT");
  return db;
}

export function db(): Database.Database {
  if (!g.__qaDb) g.__qaDb = open();
  return g.__qaDb;
}

const now = () => new Date().toISOString();

// ---------- settings ----------
export function getSettings(): Settings {
  const row = db().prepare("SELECT value FROM settings WHERE key='app'").get() as { value: string } | undefined;
  const stored = row ? (JSON.parse(row.value) as Partial<Settings>) : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    weights: { ...DEFAULT_SETTINGS.weights, ...(stored.weights ?? {}) },
    formTestData: { ...DEFAULT_SETTINGS.formTestData, ...(stored.formTestData ?? {}) },
  };
}
export function saveSettings(s: Settings) {
  db().prepare("INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(s));
}

// ---------- websites & scans ----------
export function upsertWebsite(origin: string): number {
  db().prepare("INSERT OR IGNORE INTO websites(origin, created_at) VALUES(?,?)").run(origin, now());
  return (db().prepare("SELECT id FROM websites WHERE origin=?").get(origin) as { id: number }).id;
}

type ScanRow = {
  id: string; website_id: number; url: string; mode: string; status: string; phase: string | null; progress: number;
  options_json: string; auth_enc: string | null; created_at: string; started_at: string | null; finished_at: string | null;
  scores_json: string | null; summary_json: string | null; error: string | null; baseline_scan_id: string | null;
};
function toScan(r: ScanRow): Scan {
  return {
    id: r.id, websiteId: r.website_id, url: r.url, mode: r.mode as Scan["mode"], status: r.status as Scan["status"], phase: r.phase,
    progress: r.progress, options: JSON.parse(r.options_json) as ScanOptions, hasAuth: !!r.auth_enc, createdAt: r.created_at,
    startedAt: r.started_at, finishedAt: r.finished_at, scores: r.scores_json ? JSON.parse(r.scores_json) : null,
    summary: r.summary_json ? JSON.parse(r.summary_json) : null, error: r.error, baselineScanId: r.baseline_scan_id,
  };
}

export function createScan(id: string, url: string, options: ScanOptions, authEnc: string | null): Scan {
  const origin = new URL(url).origin;
  const websiteId = upsertWebsite(origin);
  const baseline = db()
    .prepare("SELECT id FROM scans WHERE website_id=? AND status='completed' ORDER BY created_at DESC LIMIT 1")
    .get(websiteId) as { id: string } | undefined;
  db()
    .prepare("INSERT INTO scans(id, website_id, url, mode, status, progress, options_json, auth_enc, created_at, baseline_scan_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(id, websiteId, url, options.mode, "discovering", 0, JSON.stringify(options), authEnc, now(), baseline?.id ?? null);
  return getScan(id)!;
}

export function getScan(id: string): Scan | null {
  const r = db().prepare("SELECT * FROM scans WHERE id=?").get(id) as ScanRow | undefined;
  return r ? toScan(r) : null;
}
export function getScanAuth(id: string): string | null {
  return (db().prepare("SELECT auth_enc FROM scans WHERE id=?").get(id) as { auth_enc: string | null } | undefined)?.auth_enc ?? null;
}
export function listScans(limit = 100): Scan[] {
  return (db().prepare("SELECT * FROM scans ORDER BY created_at DESC LIMIT ?").all(limit) as ScanRow[]).map(toScan);
}
export function updateScan(id: string, patch: Partial<{ status: string; phase: string | null; progress: number; startedAt: string; finishedAt: string; scores: unknown; summary: unknown; error: string | null }>) {
  const map: Record<string, [string, unknown]> = {
    status: ["status", patch.status], phase: ["phase", patch.phase], progress: ["progress", patch.progress],
    startedAt: ["started_at", patch.startedAt], finishedAt: ["finished_at", patch.finishedAt],
    scores: ["scores_json", patch.scores === undefined ? undefined : JSON.stringify(patch.scores)],
    summary: ["summary_json", patch.summary === undefined ? undefined : JSON.stringify(patch.summary)], error: ["error", patch.error],
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of Object.keys(patch)) {
    const m = map[k];
    if (!m) continue;
    sets.push(`${m[0]}=?`);
    vals.push(m[1] ?? null);
  }
  if (!sets.length) return;
  db().prepare(`UPDATE scans SET ${sets.join(",")} WHERE id=?`).run(...vals, id);
}
export function deleteScan(id: string) {
  db().prepare("DELETE FROM scans WHERE id=?").run(id);
  fs.rmSync(path.join(DATA_DIR, "screenshots", id), { recursive: true, force: true });
}

// ---------- pages / links ----------
type PageRow = { id: number; scan_id: string; url: string; status_code: number | null; redirect_to: string | null; content_type: string | null; title: string | null; depth: number; source: string; selected: number; is_internal: number; error: string | null };
const toPage = (r: PageRow): PageRecord => ({
  id: r.id, scanId: r.scan_id, url: r.url, statusCode: r.status_code, redirectTo: r.redirect_to, contentType: r.content_type,
  title: r.title, depth: r.depth, source: r.source as PageRecord["source"], selected: !!r.selected, isInternal: !!r.is_internal, error: r.error,
});
export function upsertPage(scanId: string, p: Omit<PageRecord, "id" | "scanId">) {
  db()
    .prepare(`INSERT INTO pages(scan_id,url,status_code,redirect_to,content_type,title,depth,source,selected,is_internal,error)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scan_id,url) DO UPDATE SET status_code=excluded.status_code, redirect_to=excluded.redirect_to,
      content_type=excluded.content_type, title=excluded.title, error=excluded.error`)
    .run(scanId, p.url, p.statusCode, p.redirectTo, p.contentType, p.title, p.depth, p.source, p.selected ? 1 : 0, p.isInternal ? 1 : 0, p.error);
}
export function listPages(scanId: string): PageRecord[] {
  return (db().prepare("SELECT * FROM pages WHERE scan_id=? ORDER BY depth, id").all(scanId) as PageRow[]).map(toPage);
}
export function setSelectedPages(scanId: string, ids: number[]) {
  const tx = db().transaction(() => {
    db().prepare("UPDATE pages SET selected=0 WHERE scan_id=?").run(scanId);
    const st = db().prepare("UPDATE pages SET selected=1 WHERE scan_id=? AND id=?");
    for (const id of ids) st.run(scanId, id);
  });
  tx();
}
export function insertLinks(scanId: string, links: LinkRecord[]) {
  const st = db().prepare("INSERT INTO links(scan_id,from_url,to_url,status_code,kind,redirected_to,error) VALUES(?,?,?,?,?,?,?)");
  db().transaction(() => {
    for (const l of links) st.run(scanId, l.fromUrl, l.toUrl, l.statusCode, l.kind, l.redirectedTo, l.error);
  })();
}
export function listLinks(scanId: string): LinkRecord[] {
  return (db().prepare("SELECT from_url fromUrl, to_url toUrl, status_code statusCode, kind, redirected_to redirectedTo, error FROM links WHERE scan_id=?").all(scanId) as LinkRecord[]);
}

// ---------- results ----------
type ResultRow = {
  id: number; scan_id: string; case_id: string; check_key: string; category: string; page_url: string; title: string; description: string;
  expected: string; actual: string; status: string; severity: string; screenshot: string | null; error: string | null; recommendation: string | null;
  viewport: string | null; browser: string | null; meta_json: string | null; created_at: string; resolved: number; assignee: string | null; comment: string | null;
  bug_status: string; dev_comment: string | null; status_by: string | null; status_at: string | null;
};
const toResult = (r: ResultRow): TestResult => ({
  id: r.id, scanId: r.scan_id, caseId: r.case_id, checkKey: r.check_key, category: r.category as TestResult["category"], pageUrl: r.page_url,
  title: r.title, description: r.description, expected: r.expected, actual: r.actual, status: r.status as TestResult["status"],
  severity: r.severity as TestResult["severity"], screenshot: r.screenshot, error: r.error, recommendation: r.recommendation,
  viewport: r.viewport, browser: r.browser, meta: r.meta_json ? JSON.parse(r.meta_json) : null, createdAt: r.created_at,
  resolved: !!r.resolved, assignee: r.assignee, comment: r.comment,
  bugStatus: (r.bug_status ?? "open") as TestResult["bugStatus"], devComment: r.dev_comment, statusBy: r.status_by, statusAt: r.status_at,
});

const PREFIX: Record<string, string> = {
  crawl: "LNK", functional: "FUN", forms: "FRM", responsive: "RSP", images: "IMG", animation: "ANI", performance: "PRF", seo: "SEO",
  integrations: "INT", accessibility: "A11Y", email: "EML", "cross-browser": "XBR", security: "SEC",
};

export function insertResult(scanId: string, r: TestResultInput): number {
  const n = (db().prepare("SELECT COUNT(*) c FROM results WHERE scan_id=? AND category=?").get(scanId, r.category) as { c: number }).c + 1;
  const caseId = `TC-${PREFIX[r.category] ?? "GEN"}-${String(n).padStart(4, "0")}`;
  const info = db()
    .prepare(`INSERT INTO results(scan_id,case_id,check_key,category,page_url,title,description,expected,actual,status,severity,screenshot,error,recommendation,viewport,browser,meta_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(scanId, caseId, r.checkKey, r.category, r.pageUrl, r.title, r.description, r.expected, r.actual, r.status, r.severity,
      r.screenshot ?? null, r.error ?? null, r.recommendation ?? null, r.viewport ?? null, r.browser ?? null, r.meta ? JSON.stringify(r.meta) : null, now());
  return Number(info.lastInsertRowid);
}
export function listResults(scanId: string): TestResult[] {
  return (db().prepare("SELECT * FROM results WHERE scan_id=? ORDER BY id").all(scanId) as ResultRow[]).map(toResult);
}
export function getResult(id: number): TestResult | null {
  const r = db().prepare("SELECT * FROM results WHERE id=?").get(id) as ResultRow | undefined;
  return r ? toResult(r) : null;
}
export function updateResult(
  id: number,
  patch: { resolved?: boolean; assignee?: string | null; comment?: string | null; bugStatus?: BugStatus; devComment?: string | null },
  actor: { name: string; via: "admin" | "share" } = { name: "QA", via: "admin" },
) {
  const before = getResult(id);
  if (!before) return;
  db().transaction(() => {
    if (patch.resolved !== undefined) db().prepare("UPDATE results SET resolved=? WHERE id=?").run(patch.resolved ? 1 : 0, id);
    if (patch.assignee !== undefined) db().prepare("UPDATE results SET assignee=? WHERE id=?").run(patch.assignee, id);
    if (patch.comment !== undefined) db().prepare("UPDATE results SET comment=? WHERE id=?").run(patch.comment, id);
    if (patch.devComment !== undefined) db().prepare("UPDATE results SET dev_comment=? WHERE id=?").run(patch.devComment, id);
    const statusChanged = patch.bugStatus !== undefined && patch.bugStatus !== before.bugStatus;
    if (statusChanged) db().prepare("UPDATE results SET bug_status=?, status_by=?, status_at=? WHERE id=?").run(patch.bugStatus, actor.name, now(), id);
    if (statusChanged || (patch.devComment !== undefined && patch.devComment !== before.devComment)) {
      db().prepare("INSERT INTO result_activity(result_id,ts,actor,via,from_status,to_status,note) VALUES(?,?,?,?,?,?,?)")
        .run(id, now(), actor.name, actor.via, before.bugStatus, patch.bugStatus ?? before.bugStatus, patch.devComment ?? null);
    }
  })();
}
export function listActivity(resultId: number) {
  return db().prepare("SELECT id, ts, actor, via, from_status fromStatus, to_status toStatus, note FROM result_activity WHERE result_id=? ORDER BY id DESC LIMIT 50")
    .all(resultId) as { id: number; ts: string; actor: string; via: string; fromStatus: string | null; toStatus: string | null; note: string | null }[];
}

// ---------- projects (one per website origin) ----------
export function getWebsite(id: number) {
  return db().prepare("SELECT id, origin, created_at createdAt FROM websites WHERE id=?").get(id) as { id: number; origin: string; createdAt: string } | undefined;
}
export function listProjects(): Project[] {
  const sites = db().prepare("SELECT id, origin, created_at createdAt FROM websites ORDER BY created_at DESC").all() as { id: number; origin: string; createdAt: string }[];
  return sites.map((w) => {
    const latest = db().prepare("SELECT * FROM scans WHERE website_id=? ORDER BY created_at DESC LIMIT 1").get(w.id) as ScanRow | undefined;
    const sc = latest ? toScan(latest) : null;
    const scanCount = (db().prepare("SELECT COUNT(*) c FROM scans WHERE website_id=?").get(w.id) as { c: number }).c;
    const activeLinks = (db().prepare("SELECT COUNT(*) c FROM share_links WHERE website_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").get(w.id, now()) as { c: number }).c;
    return {
      ...w, scanCount, activeLinks,
      latestScan: sc ? { id: sc.id, status: sc.status, createdAt: sc.createdAt, overall: sc.scores?.overall ?? null, handoverStatus: sc.scores?.handoverStatus ?? null, a11yLevel: levelOf(sc.options), categories: categoriesOf(sc.options) } : null,
    };
  });
}
export function listWebsiteScans(websiteId: number): Scan[] {
  return (db().prepare("SELECT * FROM scans WHERE website_id=? ORDER BY created_at DESC").all(websiteId) as ScanRow[]).map(toScan);
}
export function deleteResults(scanId: string, ids: number[]) {
  const st = db().prepare("DELETE FROM results WHERE scan_id=? AND id=?");
  db().transaction(() => ids.forEach((id) => st.run(scanId, id)))();
}

// ---------- screenshots / logs ----------
export function insertScreenshot(s: Omit<ScreenshotRecord, "id">) {
  db().prepare("INSERT INTO screenshots(scan_id,page_url,viewport,browser,path,diff_path,diff_ratio) VALUES(?,?,?,?,?,?,?)")
    .run(s.scanId, s.pageUrl, s.viewport, s.browser, s.path, s.diffPath, s.diffRatio);
}
export function listScreenshots(scanId: string): ScreenshotRecord[] {
  return db().prepare("SELECT id, scan_id scanId, page_url pageUrl, viewport, browser, path, diff_path diffPath, diff_ratio diffRatio FROM screenshots WHERE scan_id=? ORDER BY id").all(scanId) as ScreenshotRecord[];
}
export function findScreenshot(scanId: string, pageUrl: string, viewport: string, browser: string): ScreenshotRecord | undefined {
  return db().prepare("SELECT id, scan_id scanId, page_url pageUrl, viewport, browser, path, diff_path diffPath, diff_ratio diffRatio FROM screenshots WHERE scan_id=? AND page_url=? AND viewport=? AND browser=? ORDER BY id DESC LIMIT 1")
    .get(scanId, pageUrl, viewport, browser) as ScreenshotRecord | undefined;
}
export function addLog(scanId: string, level: "info" | "warn" | "error", message: string) {
  db().prepare("INSERT INTO logs(scan_id,ts,level,message) VALUES(?,?,?,?)").run(scanId, now(), level, message.slice(0, 2000));
}
export function listLogs(scanId: string, afterId = 0) {
  return db().prepare("SELECT id, ts, level, message FROM logs WHERE scan_id=? AND id>? ORDER BY id").all(scanId, afterId) as { id: number; ts: string; level: string; message: string }[];
}

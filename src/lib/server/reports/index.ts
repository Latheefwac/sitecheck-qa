import "server-only";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { chromium } from "playwright";
import { DATA_DIR, getScan, listPages, listResults, listScreenshots } from "../db";
import { A11Y_LEVEL_INFO, levelOf } from "../../a11y-levels";
import { categoriesText, isPartialScan } from "../../test-categories";
import { BUG_STATUS_LABELS, CATEGORY_LABELS, SCORE_GROUPS, SCORE_GROUP_LABELS, type Scan, type TestResult } from "../../types";

export function reportData(scanId: string) {
  const scan = getScan(scanId);
  if (!scan) throw new Error("Scan not found");
  const results = listResults(scanId);
  const pages = listPages(scanId).filter((p) => p.selected);
  const shots = listScreenshots(scanId);
  return { scan, results, pages, shots };
}

const COLS: { key: keyof TestResult | "effectiveStatus"; header: string; width: number }[] = [
  { key: "caseId", header: "Test Case ID", width: 16 },
  { key: "category", header: "Category", width: 16 },
  { key: "pageUrl", header: "Page URL", width: 45 },
  { key: "title", header: "Test", width: 40 },
  { key: "description", header: "Description", width: 50 },
  { key: "expected", header: "Expected Result", width: 40 },
  { key: "actual", header: "Actual Result", width: 60 },
  { key: "effectiveStatus", header: "Status", width: 12 },
  { key: "severity", header: "Severity", width: 10 },
  { key: "viewport", header: "Viewport", width: 14 },
  { key: "browser", header: "Browser", width: 12 },
  { key: "error", header: "Error Message", width: 40 },
  { key: "recommendation", header: "Recommended Solution", width: 60 },
  { key: "screenshot", header: "Screenshot", width: 40 },
  { key: "assignee", header: "Assignee", width: 16 },
  { key: "comment", header: "Comment", width: 30 },
  { key: "bugStatus", header: "Bug Status", width: 14 },
  { key: "devComment", header: "Developer Note", width: 30 },
  { key: "createdAt", header: "Date & Time", width: 22 },
];

const eff = (r: TestResult) => (r.resolved ? "RESOLVED" : r.status === "NOT_TESTED" ? "NOT TESTED" : r.status);
const cell = (r: TestResult, k: (typeof COLS)[number]["key"]) =>
  k === "effectiveStatus" ? eff(r) : k === "category" ? CATEGORY_LABELS[r.category] : k === "bugStatus" ? BUG_STATUS_LABELS[r.bugStatus] : String(r[k as keyof TestResult] ?? "");

export function toCsv(scanId: string): string {
  const { results } = reportData(scanId);
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [COLS.map((c) => c.header).join(","), ...results.map((r) => COLS.map((c) => esc(cell(r, c.key))).join(","))].join("\r\n");
}

export async function toXlsx(scanId: string): Promise<Buffer> {
  const { scan, results, pages } = reportData(scanId);
  const wb = new ExcelJS.Workbook();
  wb.creator = "QA Platform";
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 32 }, { width: 60 }];
  const s = scan.summary;
  const rows: [string, string | number][] = [
    ["Website", scan.url], ["Scan mode", scan.mode], ["Categories tested", categoriesText(scan.options)], ["Accessibility level", A11Y_LEVEL_INFO[levelOf(scan.options)].label], ["Testing date", scan.finishedAt ?? scan.createdAt], ["Pages tested", pages.length],
    ["Overall quality score", scan.scores?.overall ?? "—"], ["QA handover status", scan.scores?.handoverStatus ?? "—"],
    ["Total test cases", s?.total ?? 0], ["Passed", s?.passed ?? 0], ["Failed", s?.failed ?? 0], ["Warnings", s?.warnings ?? 0], ["Not tested", s?.notTested ?? 0], ["Critical issues", s?.critical ?? 0],
    ...SCORE_GROUPS.map((g) => [`${SCORE_GROUP_LABELS[g]} score`, scan.scores?.groups[g] ?? "N/A"] as [string, string | number]),
    ...((scan.scores?.blockers ?? []).map((b, i) => [`Blocker ${i + 1}`, b] as [string, string])),
  ];
  rows.forEach((r) => sum.addRow(r));
  sum.getColumn(1).font = { bold: true };

  const ws = wb.addWorksheet("Test Cases", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
  const color: Record<string, string> = { PASS: "FFDCFCE7", FAIL: "FFFEE2E2", WARNING: "FFFEF3C7", "NOT TESTED": "FFF3F4F6", RESOLVED: "FFDBEAFE" };
  for (const r of results) {
    const row = ws.addRow(Object.fromEntries(COLS.map((c) => [c.key, cell(r, c.key)])));
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell("effectiveStatus").fill = { type: "pattern", pattern: "solid", fgColor: { argb: color[eff(r)] } };
  }
  ws.autoFilter = { from: "A1", to: { row: 1, column: COLS.length } };

  const pw = wb.addWorksheet("Pages");
  pw.columns = [{ header: "URL", key: "url", width: 60 }, { header: "HTTP", key: "status", width: 8 }, { header: "Title", key: "title", width: 50 }, { header: "Passed", key: "p", width: 8 }, { header: "Failed", key: "f", width: 8 }, { header: "Warnings", key: "w", width: 10 }];
  pw.getRow(1).font = { bold: true };
  for (const p of pages) {
    const pr = results.filter((r) => r.pageUrl === p.url);
    pw.addRow({ url: p.url, status: p.statusCode, title: p.title, p: pr.filter((r) => eff(r) === "PASS" || eff(r) === "RESOLVED").length, f: pr.filter((r) => eff(r) === "FAIL").length, w: pr.filter((r) => eff(r) === "WARNING").length });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function img(rel: string | null | undefined, max = 520): string {
  if (!rel) return "";
  const abs = path.join(DATA_DIR, rel);
  if (!abs.startsWith(DATA_DIR) || !fs.existsSync(abs)) return "";
  const buf = fs.readFileSync(abs);
  if (buf.length > 2_500_000) return "";
  const mime = rel.endsWith(".png") ? "image/png" : "image/jpeg";
  return `<img src="data:${mime};base64,${buf.toString("base64")}" style="max-width:${max}px;max-height:420px;border:1px solid #e5e7eb;border-radius:6px"/>`;
}

export function reportHtml(scanId: string): string {
  const { scan, results, pages, shots } = reportData(scanId);
  const s = scan.summary;
  const sc = scan.scores;
  const issues = results.filter((r) => !r.resolved && (r.status === "FAIL" || r.status === "WARNING"));
  const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  issues.sort((a, b) => (a.status === b.status ? 0 : a.status === "FAIL" ? -1 : 1) || sevOrder[a.severity] - sevOrder[b.severity]);
  const statusColor = sc?.handoverStatus === "READY FOR QA" ? "#16a34a" : sc?.handoverStatus === "READY WITH WARNINGS" ? "#d97706" : "#dc2626";
  const pill = (st: string) => `<span class="pill ${st.toLowerCase().replace(" ", "")}">${st}</span>`;
  const keyShots = shots.filter((x) => x.browser === "chromium" && ["desktop-1440", "tablet-768", "mobile-390"].includes(x.viewport)).slice(0, 12);

  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Report — ${escHtml(scan.url)}</title><style>
  *{box-sizing:border-box}body{font-family:-apple-system,Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;margin:0;font-size:11px;line-height:1.45}
  .page{padding:28px 34px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid #e5e7eb}h3{font-size:12px;margin:14px 0 6px}
  .muted{color:#6b7280}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
  .big{font-size:22px;font-weight:700}.status{display:inline-block;padding:6px 12px;border-radius:6px;color:#fff;font-weight:700;background:${statusColor}}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #f3f4f6;vertical-align:top}th{background:#f9fafb;font-weight:600}
  .pill{padding:1px 6px;border-radius:4px;font-size:9.5px;font-weight:700}.pass{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}.warning{background:#fef3c7;color:#92400e}.nottested{background:#f3f4f6;color:#374151}
  .sev-Critical{color:#991b1b;font-weight:700}.sev-High{color:#c2410c;font-weight:600}.issue{border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px;page-break-inside:avoid}
  pre{white-space:pre-wrap;word-break:break-word;background:#f9fafb;padding:6px;border-radius:4px;margin:4px 0;font-size:10px}.bar{height:6px;background:#f3f4f6;border-radius:3px}.bar>div{height:6px;border-radius:3px}
  .shots{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.shots img{max-width:100%!important}
  </style></head><body><div class="page">
  <div class="muted">Website Quality Assurance Report</div>
  <h1>${escHtml(scan.url)}</h1>
  <div class="muted">${scan.mode === "full" ? "Full" : "Quick"} scan · Accessibility: ${escHtml(A11Y_LEVEL_INFO[levelOf(scan.options)].label)} · Categories: ${escHtml(categoriesText(scan.options))} · Tested ${escHtml(new Date(scan.finishedAt ?? scan.createdAt).toLocaleString())} · ${pages.length} page(s) · Scan ID ${scan.id}</div>
  <h2>1. QA handover status</h2>
  <div class="status">${sc?.handoverStatus ?? "NOT SCORED"}</div>
  ${isPartialScan(scan.options) ? `<p class="muted"><strong>Partial scan:</strong> only ${escHtml(categoriesText(scan.options))} (plus crawl and link checks) were tested. This status covers those categories only.</p>` : ""}
  ${sc?.blockers.length ? `<ul>${sc.blockers.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>` : `<p>No blocking issues. ${sc?.handoverStatus === "READY WITH WARNINGS" ? "Review warnings before production." : ""}</p>`}
  <h2>2. Summary</h2>
  <div class="grid">
    <div class="card"><div class="muted">Overall quality score</div><div class="big">${sc?.overall ?? "—"}</div></div>
    <div class="card"><div class="muted">Test cases</div><div class="big">${s?.total ?? 0}</div></div>
    <div class="card"><div class="muted">Passed / Failed</div><div class="big"><span style="color:#16a34a">${s?.passed ?? 0}</span> / <span style="color:#dc2626">${s?.failed ?? 0}</span></div></div>
    <div class="card"><div class="muted">Warnings / Critical</div><div class="big"><span style="color:#d97706">${s?.warnings ?? 0}</span> / <span style="color:#991b1b">${s?.critical ?? 0}</span></div></div>
  </div>
  <h2>3. Category scores</h2>
  <table><tr><th>Category</th><th style="width:60%">Score</th><th>Value</th></tr>
  ${SCORE_GROUPS.map((g) => { const v = sc?.groups[g]; const c = v === null || v === undefined ? "#d1d5db" : v >= 90 ? "#16a34a" : v >= 70 ? "#d97706" : "#dc2626"; return `<tr><td>${SCORE_GROUP_LABELS[g]}</td><td><div class="bar"><div style="width:${v ?? 0}%;background:${c}"></div></div></td><td>${v ?? "N/A"}</td></tr>`; }).join("")}
  </table>
  <h2>4. Page-wise results</h2>
  <table><tr><th>Page</th><th>HTTP</th><th>Pass</th><th>Fail</th><th>Warn</th></tr>
  ${pages.map((p) => { const pr = results.filter((r) => r.pageUrl === p.url); return `<tr><td>${escHtml(p.url)}</td><td>${p.statusCode ?? ""}</td><td>${pr.filter((r) => r.status === "PASS" || r.resolved).length}</td><td>${pr.filter((r) => r.status === "FAIL" && !r.resolved).length}</td><td>${pr.filter((r) => r.status === "WARNING" && !r.resolved).length}</td></tr>`; }).join("")}
  </table>
  ${keyShots.length ? `<h2>5. Responsive screenshots</h2><div class="shots">${keyShots.map((x) => `<div><div class="muted">${escHtml(new URL(x.pageUrl).pathname)} · ${x.viewport}</div>${img(x.path, 300)}</div>`).join("")}</div>` : ""}
  <h2>6. Issues & recommended fixes (${issues.length})</h2>
  ${issues.slice(0, 300).map((r) => `<div class="issue"><div>${pill(r.status)} <span class="sev-${r.severity}">${r.severity}</span> · <b>${escHtml(r.caseId)}</b> · ${escHtml(CATEGORY_LABELS[r.category])}${r.viewport ? ` · ${escHtml(r.viewport)}` : ""}${r.browser ? ` · ${escHtml(r.browser)}` : ""}</div>
    <h3>${escHtml(r.title)}</h3><div class="muted">${escHtml(r.pageUrl)}</div>
    <div><b>Expected:</b> ${escHtml(r.expected)}</div><div><b>Actual:</b></div><pre>${escHtml(r.actual.slice(0, 1500))}</pre>
    ${r.recommendation ? `<div><b>Recommended fix:</b> ${escHtml(r.recommendation)}</div>` : ""}${r.assignee ? `<div><b>Assigned to:</b> ${escHtml(r.assignee)}</div>` : ""}${r.comment ? `<div><b>Comment:</b> ${escHtml(r.comment)}</div>` : ""}${r.bugStatus !== "open" ? `<div><b>Bug status:</b> ${escHtml(BUG_STATUS_LABELS[r.bugStatus])}${r.statusBy ? ` (${escHtml(r.statusBy)})` : ""}</div>` : ""}${r.devComment ? `<div><b>Developer note:</b> ${escHtml(r.devComment)}</div>` : ""}
    ${r.screenshot && (r.severity === "Critical" || r.severity === "High") ? img(r.screenshot) : ""}</div>`).join("")}
  ${issues.length > 300 ? `<p class="muted">${issues.length - 300} more issues are available in the Excel/CSV export.</p>` : ""}
  <h2>7. All test cases</h2>
  <table><tr><th>ID</th><th>Category</th><th>Test</th><th>Page</th><th>Status</th><th>Severity</th></tr>
  ${results.map((r) => `<tr><td>${r.caseId}</td><td>${escHtml(CATEGORY_LABELS[r.category])}</td><td>${escHtml(r.title)}</td><td>${escHtml(new URL(r.pageUrl).pathname)}</td><td>${pill(eff(r))}</td><td>${r.severity}</td></tr>`).join("")}
  </table>
  <p class="muted" style="margin-top:24px">Scores: each executed test contributes its severity weight (Critical 10, High 5, Medium 3, Low 1); PASS earns full weight, WARNING half, FAIL none. Lighthouse and axe scores are blended 50/50 into Performance and Accessibility. Overall = weighted average of category scores. A site is never marked ready while critical issues remain.</p>
  </div></body></html>`;
}

export async function toPdf(scanId: string): Promise<Buffer> {
  const html = reportHtml(scanId);
  const b = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    const page = await b.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "14mm", left: "8mm", right: "8mm" }, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#9ca3af">QA Report · <span class="pageNumber"></span>/<span class="totalPages"></span></div>` });
  } finally {
    await b.close();
  }
}

export type { Scan };

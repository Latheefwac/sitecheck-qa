// Transparent, configurable scoring (unit tested).
import {
  CATEGORY_TO_GROUP,
  SCORE_GROUPS,
  type CategoryScores,
  type ScanSummary,
  type ScoreGroup,
  type Settings,
  type Severity,
  type TestResultInput,
} from "./types";

/** How much each severity weighs in a category score. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { Critical: 10, High: 5, Medium: 3, Low: 1 };

type Scorable = Pick<TestResultInput, "status" | "severity" | "category" | "meta"> & { resolved?: boolean };

/**
 * Group score = 100 × earned / possible, where each executed test contributes its severity weight.
 * PASS earns full weight, WARNING earns half, FAIL earns zero. NOT_TESTED and resolved issues are ignored
 * (resolved = counted as passing, since a developer confirmed the fix).
 * For performance/accessibility a measured tool score (Lighthouse / axe) is blended 50/50 when present.
 */
export function computeScores(results: Scorable[], settings: Pick<Settings, "weights" | "productionThreshold" | "maxHighIssuesForReady">): CategoryScores {
  const earned: Record<string, number> = {};
  const possible: Record<string, number> = {};
  const measured: Record<string, number[]> = {};
  let criticalOpen = 0;
  let highOpen = 0;

  for (const r of results) {
    if (r.status === "NOT_TESTED") continue;
    const g = CATEGORY_TO_GROUP[r.category];
    const w = SEVERITY_WEIGHT[r.severity];
    possible[g] = (possible[g] ?? 0) + w;
    const status = r.resolved ? "PASS" : r.status;
    earned[g] = (earned[g] ?? 0) + (status === "PASS" ? w : status === "WARNING" ? w / 2 : 0);
    if (status === "FAIL" && r.severity === "Critical") criticalOpen++;
    if (status === "FAIL" && r.severity === "High") highOpen++;
    const toolScore = r.meta && typeof r.meta.toolScore === "number" ? (r.meta.toolScore as number) : null;
    if (toolScore !== null) (measured[g] ??= []).push(toolScore);
  }

  const groups = {} as Record<ScoreGroup, number | null>;
  for (const g of SCORE_GROUPS) {
    if (!possible[g]) {
      groups[g] = null;
      continue;
    }
    let s = (earned[g] / possible[g]) * 100;
    const m = measured[g];
    if (m?.length) s = s * 0.5 + (m.reduce((a, b) => a + b, 0) / m.length) * 0.5;
    groups[g] = Math.round(s);
  }

  let wSum = 0;
  let total = 0;
  for (const g of SCORE_GROUPS) {
    const v = groups[g];
    const w = settings.weights[g] ?? 0;
    if (v === null || w <= 0) continue;
    wSum += w;
    total += v * w;
  }
  const overall = wSum ? Math.round(total / wSum) : 0;

  const blockers: string[] = [];
  if (criticalOpen > 0) blockers.push(`${criticalOpen} critical issue(s) remain open`);
  if (highOpen > settings.maxHighIssuesForReady) blockers.push(`${highOpen} high-severity issue(s) exceed the allowed ${settings.maxHighIssuesForReady}`);
  if (overall < settings.productionThreshold) blockers.push(`Overall score ${overall} is below the ${settings.productionThreshold} threshold`);

  // Critical issues always block, regardless of the average score.
  const productionReady = blockers.length === 0;
  const hasWarnings = results.some((r) => !r.resolved && (r.status === "WARNING" || r.status === "FAIL"));
  const handoverStatus = !productionReady ? "NOT READY" : hasWarnings ? "READY WITH WARNINGS" : "READY FOR QA";
  return { groups, overall, productionReady, handoverStatus, blockers };
}

export function summarize(results: Scorable[], pages: number): ScanSummary {
  const s: ScanSummary = {
    pages,
    total: results.length,
    passed: 0,
    failed: 0,
    warnings: 0,
    notTested: 0,
    critical: 0,
    bySeverity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
    byCategory: {},
  };
  for (const r of results) {
    const c = (s.byCategory[r.category] ??= { pass: 0, fail: 0, warning: 0, notTested: 0 });
    const status = r.resolved ? "PASS" : r.status;
    if (status === "PASS") {
      s.passed++;
      c.pass++;
    } else if (status === "FAIL") {
      s.failed++;
      c.fail++;
      s.bySeverity[r.severity]++;
      if (r.severity === "Critical") s.critical++;
    } else if (status === "WARNING") {
      s.warnings++;
      c.warning++;
      s.bySeverity[r.severity]++;
    } else {
      s.notTested++;
      c.notTested++;
    }
  }
  return s;
}

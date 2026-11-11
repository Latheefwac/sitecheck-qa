import { describe, expect, it } from "vitest";
import { computeScores, summarize } from "@/lib/scoring";
import { DEFAULT_SETTINGS, type TestResultInput } from "@/lib/types";

const r = (category: TestResultInput["category"], status: TestResultInput["status"], severity: TestResultInput["severity"] = "Medium", meta?: Record<string, unknown>) => ({ category, status, severity, meta: meta ?? null });

describe("computeScores", () => {
  it("weights results by severity; warnings earn half", () => {
    const s = computeScores([r("seo", "PASS", "High"), r("seo", "FAIL", "Low"), r("seo", "WARNING", "Medium")], DEFAULT_SETTINGS);
    // earned = 5 + 0 + 1.5 = 6.5 of 9
    expect(s.groups.seo).toBe(72);
  });
  it("ignores NOT_TESTED and returns null for untested groups", () => {
    const s = computeScores([r("seo", "PASS"), r("animation", "NOT_TESTED")], DEFAULT_SETTINGS);
    expect(s.groups.animation).toBeNull();
    expect(s.overall).toBe(100);
  });
  it("blends tool scores 50/50", () => {
    const s = computeScores([r("performance", "PASS", "Medium", { toolScore: 40 })], DEFAULT_SETTINGS);
    expect(s.groups.performance).toBe(70);
  });
  it("never marks a site ready while a critical issue is open, even with a high average", () => {
    const many = Array.from({ length: 200 }, () => r("functional", "PASS", "Critical"));
    const s = computeScores([...many, r("functional", "FAIL", "Critical")], { ...DEFAULT_SETTINGS, productionThreshold: 50 });
    expect(s.overall).toBeGreaterThan(90);
    expect(s.productionReady).toBe(false);
    expect(s.handoverStatus).toBe("NOT READY");
    expect(s.blockers[0]).toMatch(/critical/);
  });
  it("treats resolved failures as passing", () => {
    const s = computeScores([{ ...r("security", "FAIL", "Critical"), resolved: true }], DEFAULT_SETTINGS);
    expect(s.productionReady).toBe(true);
    expect(s.handoverStatus).toBe("READY FOR QA");
  });
  it("uses configurable weights for the overall score", () => {
    const res = [r("seo", "PASS"), r("performance", "FAIL")];
    const w = { ...DEFAULT_SETTINGS.weights, seo: 3, performance: 1 };
    expect(computeScores(res, { ...DEFAULT_SETTINGS, weights: w }).overall).toBe(75);
  });
  it("reports READY WITH WARNINGS when only warnings remain", () => {
    const s = computeScores([...Array.from({ length: 20 }, () => r("seo", "PASS")), r("seo", "WARNING", "Low")], DEFAULT_SETTINGS);
    expect(s.handoverStatus).toBe("READY WITH WARNINGS");
  });
});

describe("summarize", () => {
  it("counts statuses, severities and categories", () => {
    const s = summarize([r("seo", "PASS"), r("seo", "FAIL", "Critical"), r("forms", "WARNING", "Low"), r("email", "NOT_TESTED")], 3);
    expect(s).toMatchObject({ pages: 3, total: 4, passed: 1, failed: 1, warnings: 1, notTested: 1, critical: 1 });
    expect(s.bySeverity.Critical).toBe(1);
    expect(s.byCategory.seo).toEqual({ pass: 1, fail: 1, warning: 0, notTested: 0 });
  });
});

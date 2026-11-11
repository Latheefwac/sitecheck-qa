import { describe, expect, it } from "vitest";
import { categoriesOf, categoriesText, isPartialScan, runsCategory, TESTABLE_CATEGORIES } from "@/lib/test-categories";

describe("test categories", () => {
  it("treats old scans without categories as running everything", () => {
    expect(categoriesOf({})).toEqual([...TESTABLE_CATEGORIES]);
    expect(isPartialScan({})).toBe(false);
    expect(categoriesText(undefined)).toBe("All categories");
  });
  it("keeps the chosen categories in a stable order", () => {
    const o = { categories: ["accessibility", "seo"] as const };
    expect(categoriesOf({ categories: [...o.categories] })).toEqual(["seo", "accessibility"]);
    expect(isPartialScan({ categories: [...o.categories] })).toBe(true);
  });
  it("always runs crawl, and only the chosen categories otherwise", () => {
    const o = { categories: ["performance" as const] };
    expect(runsCategory(o, "crawl")).toBe(true);
    expect(runsCategory(o, "performance")).toBe(true);
    expect(runsCategory(o, "seo")).toBe(false);
  });
});

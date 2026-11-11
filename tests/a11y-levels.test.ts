import { describe, expect, it } from "vitest";
import { axeRunFor, isBestPracticeOnly, levelOf, lighthouseA11yScore, LIGHTHOUSE_A11Y_WEIGHTS } from "@/lib/a11y-levels";

describe("accessibility levels", () => {
  it("basic runs exactly the Lighthouse audit rules", () => {
    const run = axeRunFor("basic");
    expect(run.tags).toBeUndefined();
    expect(run.rules).toHaveLength(57);
    expect(run.rules).toContain("color-contrast");
    expect(run.rules).not.toContain("region");
  });
  it("A excludes AA tags; AA includes them", () => {
    expect(axeRunFor("wcag-a").tags).toEqual(["wcag2a", "wcag21a"]);
    expect(axeRunFor("wcag-aa").tags).toContain("wcag21aa");
  });
  it("old scans without a level are treated as AA", () => {
    expect(levelOf({})).toBe("wcag-aa");
    expect(levelOf({ a11yLevel: "basic" })).toBe("basic");
  });
  it("detects best-practice-only rules", () => {
    expect(isBestPracticeOnly(["cat.semantics", "best-practice"])).toBe(true);
    expect(isBestPracticeOnly(["wcag2a", "wcag111"])).toBe(false);
  });
  it("computes the Lighthouse weighted score", () => {
    const all = Object.keys(LIGHTHOUSE_A11Y_WEIGHTS);
    const onlyThese = (ids: string[]) => all.filter((id) => !ids.includes(id));
    expect(lighthouseA11yScore(onlyThese(["image-alt", "button-name"]), [])).toBe(100);
    // image-alt (10) fails; button-name (10) + heading-order (3) apply and pass → 13/23
    expect(lighthouseA11yScore(onlyThese(["image-alt", "button-name", "heading-order"]), ["image-alt"])).toBe(Math.round((13 / 23) * 100));
    // a rule that is neither inapplicable nor violated (e.g. needs review) counts as passed, like Lighthouse
    expect(lighthouseA11yScore(onlyThese(["image-alt", "color-contrast"]), ["image-alt"])).toBe(Math.round((7 / 17) * 100));
    // informative audits (e.g. bypass) never change the score, even when violated
    expect(lighthouseA11yScore(onlyThese(["image-alt", "bypass"]), ["image-alt", "bypass"])).toBe(0);
    expect(lighthouseA11yScore(onlyThese(["image-alt", "bypass"]), ["bypass"])).toBe(100);
    // demo home page: Lighthouse reported 138/151 → 91
    const home = ["aria-allowed-attr", "aria-conditional-attr", "aria-hidden-body", "aria-prohibited-attr", "aria-valid-attr-value", "aria-valid-attr", "button-name", "bypass", "color-contrast", "document-title", "duplicate-id-aria", "form-field-multiple-labels", "heading-order", "html-has-lang", "html-lang-valid", "image-alt", "image-redundant-alt", "label", "link-name", "list", "listitem", "meta-viewport", "target-size"];
    expect(lighthouseA11yScore(onlyThese(home), ["heading-order", "image-alt"])).toBe(91);
    expect(lighthouseA11yScore(all, [])).toBeNull();
    expect(all).toHaveLength(57);
  });
});

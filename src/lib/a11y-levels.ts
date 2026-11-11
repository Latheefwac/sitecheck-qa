// Accessibility conformance levels a project can be tested against (pure, unit tested).

export const A11Y_LEVELS = ["basic", "wcag-a", "wcag-aa"] as const;
export type A11yLevel = (typeof A11Y_LEVELS)[number];

export const A11Y_LEVEL_INFO: Record<A11yLevel, { label: string; short: string; description: string }> = {
  basic: {
    label: "Basic – PageSpeed / Lighthouse accessibility",
    short: "Basic (Lighthouse)",
    description: "The same axe rules and weights Google PageSpeed Insights uses for its accessibility score. Target: 100.",
  },
  "wcag-a": {
    label: "WCAG 2.1 Level A",
    short: "WCAG 2.1 A",
    description: "All automated WCAG 2.0/2.1 Level A rules, plus keyboard access and ARIA widget checks.",
  },
  "wcag-aa": {
    label: "WCAG 2.1 Level AA",
    short: "WCAG 2.1 AA",
    description: "Level A and AA rules (adds colour contrast, focus visibility and more). Best-practice rules are reported as warnings.",
  },
};

/** Scans created before levels existed ran the full AA suite. */
export const levelOf = (opts: { a11yLevel?: A11yLevel } | null | undefined): A11yLevel => opts?.a11yLevel ?? "wcag-aa";

/**
 * Lighthouse 12.8 accessibility audits (axe rule id → weight), from lighthouse/core/config/default-config.js.
 * Lighthouse score = Σ weight of passing audits ÷ Σ weight of applicable audits.
 */
export const LIGHTHOUSE_A11Y_WEIGHTS: Record<string, number> = {
  accesskeys: 7, "aria-allowed-attr": 10, "aria-allowed-role": 1, "aria-command-name": 7, "aria-conditional-attr": 7, "aria-deprecated-role": 1,
  "aria-dialog-name": 7, "aria-hidden-body": 10, "aria-hidden-focus": 7, "aria-input-field-name": 7, "aria-meter-name": 7, "aria-progressbar-name": 7,
  "aria-prohibited-attr": 7, "aria-required-attr": 10, "aria-required-children": 10, "aria-required-parent": 10, "aria-roles": 7, "aria-text": 7,
  "aria-toggle-field-name": 7, "aria-tooltip-name": 7, "aria-treeitem-name": 7, "aria-valid-attr-value": 10, "aria-valid-attr": 10, "button-name": 10,
  bypass: 7, "color-contrast": 7, "definition-list": 7, dlitem: 7, "document-title": 7, "duplicate-id-aria": 10, "form-field-multiple-labels": 3,
  "frame-title": 7, "heading-order": 3, "html-has-lang": 7, "html-lang-valid": 7, "html-xml-lang-mismatch": 3, "image-alt": 10, "image-redundant-alt": 1,
  "input-button-name": 10, "input-image-alt": 10, label: 7, "link-in-text-block": 7, "link-name": 7, list: 7, listitem: 7, "meta-refresh": 10,
  "meta-viewport": 10, "object-alt": 7, "select-name": 7, "skip-link": 3, tabindex: 7, "table-duplicate-name": 1, "target-size": 7,
  "td-headers-attr": 7, "th-has-data-cells": 7, "valid-lang": 7, "video-caption": 10,
};

/**
 * Lighthouse marks these audits "informative": they never change the score (weight forced to 0) and a
 * violation is shown for information only. Basic reports them as warnings.
 */
export const LIGHTHOUSE_INFORMATIVE = new Set(["bypass", "duplicate-id-aria", "form-field-multiple-labels", "th-has-data-cells", "video-caption"]);

/** axe-core run configuration for a level. */
export function axeRunFor(level: A11yLevel): { tags?: string[]; rules?: string[] } {
  if (level === "basic") return { rules: Object.keys(LIGHTHOUSE_A11Y_WEIGHTS) };
  if (level === "wcag-a") return { tags: ["wcag2a", "wcag21a"] };
  return { tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] };
}

/** True when a violated rule only carries best-practice tags (no WCAG success criterion). */
export const isBestPracticeOnly = (tags: string[]) => !tags.some((t) => /^wcag\d+a+$/.test(t));

/**
 * Lighthouse-equivalent score, using Lighthouse's own rule: an audit fails only when axe reports a
 * violation, is excluded only when axe reports it inapplicable, and otherwise passes (including
 * "incomplete"/needs-review results). Informative audits never count. Null when no audit applies.
 */
export function lighthouseA11yScore(inapplicable: string[], violated: string[]): number | null {
  const na = new Set(inapplicable);
  const bad = new Set(violated);
  let total = 0;
  let got = 0;
  for (const [id, w] of Object.entries(LIGHTHOUSE_A11Y_WEIGHTS)) {
    if (LIGHTHOUSE_INFORMATIVE.has(id) || (na.has(id) && !bad.has(id))) continue;
    total += w;
    if (!bad.has(id)) got += w;
  }
  return total ? Math.round((got / total) * 100) : null;
}

import "server-only";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { PageRecord, Severity } from "../../../types";
import type { ScanContext } from "../context";
import { A11Y_LEVEL_INFO, LIGHTHOUSE_INFORMATIVE, axeRunFor, isBestPracticeOnly, levelOf, lighthouseA11yScore } from "../../../a11y-levels";

// Inject the same axe-core build Lighthouse uses (the project's top-level axe-core), not the older copy
// bundled inside @axe-core/playwright. Rule results differ between axe versions (e.g. target-size), and
// "Basic" must match PageSpeed Insights.
let axeSource: string | undefined | null = null;
function axeSourceOnce(): string | undefined {
  if (axeSource === null) {
    try {
      axeSource = fs.readFileSync(path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");
    } catch {
      axeSource = undefined;
    }
  }
  return axeSource;
}

const IMPACT: Record<string, Severity> = { critical: "Critical", serious: "High", moderate: "Medium", minor: "Low" };

// Map axe rules to friendlier names the UI team recognises.
const RULE_GROUP: Record<string, string> = {
  "image-alt": "Missing alt attributes",
  "input-image-alt": "Missing alt attributes",
  label: "Missing form labels",
  "select-name": "Missing form labels",
  "button-name": "Button accessibility",
  "link-name": "Link accessibility",
  "color-contrast": "Color contrast",
  "heading-order": "Heading hierarchy",
  "page-has-heading-one": "Heading hierarchy",
  "aria-allowed-attr": "ARIA attributes",
  "aria-required-attr": "ARIA attributes",
  "aria-valid-attr-value": "ARIA attributes",
  "aria-hidden-focus": "ARIA attributes",
  "document-title": "Screen reader accessibility",
  "html-has-lang": "Screen reader accessibility",
  "landmark-one-main": "Screen reader accessibility",
  region: "Screen reader accessibility",
  "aria-dialog-name": "Modal accessibility",
};

export async function accessibilityPage(ctx: ScanContext, p: PageRecord, page: Page) {
  const url = p.url;
  const base = { category: "accessibility" as const, pageUrl: url };
  const level = levelOf(ctx.options);
  const info = A11Y_LEVEL_INFO[level];
  const run = axeRunFor(level);
  let results;
  try {
    const builder = new AxeBuilder({ page, axeSource: axeSourceOnce() });
    if (run.rules) builder.withRules(run.rules);
    if (run.tags) builder.withTags(run.tags);
    results = await builder.analyze();
  } catch (e) {
    ctx.notTested({ ...base, checkKey: "a11y.axe", title: `${info.short} accessibility scan`, description: "Automated accessibility scan", reason: `axe failed: ${(e as Error).message}`, severity: "High" });
    return;
  }

  // At AA, rules with no WCAG criterion (best practice) are warnings; at A and Basic every selected rule must pass.
  // Basic: Lighthouse "informative" audits never affect the PageSpeed score, so they are warnings too.
  const softRule = (v: { id: string; tags: string[] }) => (level === "wcag-aa" && isBestPracticeOnly(v.tags)) || (level === "basic" && LIGHTHOUSE_INFORMATIVE.has(v.id));
  const hard = results.violations.filter((v) => !softRule(v));

  // Tool score blended into the Accessibility category. Basic uses the exact Lighthouse weighting,
  // so it matches the PageSpeed Insights accessibility score for the same rules.
  let toolScore: number;
  if (level === "basic") {
    toolScore = lighthouseA11yScore(results.inapplicable.map((r) => r.id), results.violations.map((r) => r.id)) ?? 100;
  } else {
    const pen = hard.reduce((s, v) => s + ({ critical: 10, serious: 6, moderate: 3, minor: 1 }[v.impact ?? "minor"] ?? 1) * Math.min(v.nodes.length, 5), 0);
    toolScore = Math.max(0, 100 - pen);
  }

  const summary = results.violations.map((v) => `[${v.impact}] ${v.id}: ${v.nodes.length} element(s)${softRule(v) ? (level === "basic" ? " (informative)" : " (best practice)") : ""}`).join("\n");
  ctx.check(
    {
      ...base,
      checkKey: `a11y.level.${level}`,
      title: level === "basic" ? "Lighthouse accessibility score (PageSpeed)" : `${info.short} automated scan`,
      description: `${info.description} axe-core ${results.testEngine.version}: ${results.passes.length} rules passed, ${results.violations.length} violated.`,
      expected: level === "basic" ? "Score 100 (no failing Lighthouse accessibility audits)" : "0 violations",
      actual: (level === "basic" ? `Score ${toolScore}/100\n` : "") + (summary || "No violations"),
      severity: hard.some((v) => v.impact === "critical") ? "Critical" : "High",
      recommendation: results.violations.length ? "Fix each violation below. Automated tools find roughly 30–40% of issues, so follow up with manual testing." : null,
      meta: { toolScore, level, incomplete: results.incomplete.length, failedAudits: level === "basic" ? hard.map((v) => v.id) : undefined },
    },
    hard.length === 0 ? (results.violations.length ? "warn" : true) : false,
  );

  for (const v of results.violations) {
    const shot = v.nodes[0]?.target?.[0] && typeof v.nodes[0].target[0] === "string" ? await highlight(ctx, page, v.nodes[0].target[0] as string, `a11y-${v.id}`) : null;
    const wcag = v.tags.filter((t) => /^wcag\d/.test(t)).join(", ");
    ctx.add({
      ...base,
      checkKey: `a11y.${v.id}`,
      title: `${RULE_GROUP[v.id] ?? "Accessibility"}: ${v.help}`,
      description: `${v.description} (${wcag ? `WCAG: ${wcag}` : "best practice"}${level === "basic" ? " · Lighthouse audit" : ""})`,
      expected: "No elements violate this rule",
      actual: v.nodes.slice(0, 8).map((n) => `${n.target.join(" ")}\n  ${n.failureSummary?.split("\n").slice(1, 2).join("").trim() ?? ""}`).join("\n") + (v.nodes.length > 8 ? `\n…and ${v.nodes.length - 8} more` : ""),
      status: softRule(v) ? "WARNING" : "FAIL",
      severity: IMPACT[v.impact ?? "minor"] ?? "Low",
      screenshot: shot,
      recommendation: `${v.help}. See ${v.helpUrl}`,
      meta: { rule: v.id, nodes: v.nodes.length, helpUrl: v.helpUrl, level },
    });
  }

  // Basic matches PageSpeed exactly, so the manual-style checks below (not part of Lighthouse) are skipped.
  if (level === "basic") return;

  // ---- keyboard navigation & focus visibility ----
  const kb = await keyboardAudit(page);
  ctx.check({ ...base, checkKey: "a11y.keyboard-nav", title: "Keyboard navigation", description: "Tab key moves focus through interactive elements without trapping", expected: "Focus moves to ≥ 1 element and is never trapped", actual: `${kb.reached} unique element(s) reached in ${kb.presses} Tab presses${kb.trapped ? " — focus appears TRAPPED" : ""}; ${kb.interactive} focusable elements on page`, severity: kb.trapped ? "Critical" : "High", recommendation: kb.reached === 0 ? "Ensure links/buttons are focusable (no tabindex=-1, use native elements)." : kb.trapped ? "Remove the keyboard trap so users can Tab out." : null }, kb.reached > 0 && !kb.trapped);
  if (level === "wcag-aa") ctx.check({ ...base, checkKey: "a11y.focus-visible", title: "Focus visibility", description: "Focused elements show a visible focus indicator", expected: "Every focused element has an outline/box-shadow/border change", actual: kb.noIndicator.length ? `${kb.noIndicator.length} element(s) without visible focus:\n${kb.noIndicator.slice(0, 10).join("\n")}` : `All ${kb.reached} checked elements show focus`, severity: "High", recommendation: kb.noIndicator.length ? "Don't remove outlines; add :focus-visible { outline: 2px solid; outline-offset: 2px }." : null }, kb.reached === 0 ? "warn" : kb.noIndicator.length === 0 ? true : kb.noIndicator.length <= 2 ? "warn" : false);
  const skip = level !== "wcag-aa" || await page.evaluate(() => !![...document.querySelectorAll("a[href^='#']")].slice(0, 3).find((a) => /skip|main content/i.test(a.textContent ?? "")));
  if (level === "wcag-aa") ctx.check({ ...base, checkKey: "a11y.skip-link", title: "Skip to content link", description: "A skip link lets keyboard users bypass navigation", expected: "Skip link among first links", actual: skip ? "Present" : "Not found", severity: "Low", recommendation: skip ? null : 'Add <a href="#main" class="skip-link">Skip to content</a> as the first focusable element.' }, skip ? true : "warn");

  // ---- dropdown / modal ARIA semantics ----
  const aria = await page.evaluate(() => {
    const issues: string[] = [];
    document.querySelectorAll("[aria-haspopup], [aria-expanded]").forEach((el) => {
      const ctrl = el.getAttribute("aria-controls");
      if (ctrl && !document.getElementById(ctrl)) issues.push(`aria-controls="${ctrl}" points to missing id (${el.tagName.toLowerCase()})`);
      if (!["BUTTON", "A", "SUMMARY", "INPUT"].includes(el.tagName) && !el.getAttribute("role") && !el.hasAttribute("tabindex")) issues.push(`<${el.tagName.toLowerCase()}> with aria-expanded is not focusable/role-less`);
    });
    document.querySelectorAll("[role=dialog], dialog").forEach((d) => {
      if (!d.getAttribute("aria-label") && !d.getAttribute("aria-labelledby")) issues.push("Dialog without accessible name");
      if (d.getAttribute("role") === "dialog" && d.getAttribute("aria-modal") !== "true") issues.push("role=dialog without aria-modal=true");
    });
    return issues;
  });
  ctx.check({ ...base, checkKey: "a11y.widgets", title: "Dropdown & modal accessibility", description: "Disclosure widgets and dialogs expose correct ARIA", expected: "Valid aria-controls, named dialogs with aria-modal", actual: aria.length ? aria.slice(0, 10).join("\n") : "No issues found", severity: "Medium", recommendation: aria.length ? "Follow the WAI-ARIA Authoring Practices for menu buttons and dialogs." : null }, aria.length === 0);
}

async function keyboardAudit(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.mouse.click(1, 1).catch(() => {});
  const interactive = await page.evaluate(() => document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])").length);
  const presses = Math.min(25, Math.max(5, interactive));
  const seen = new Set<string>();
  const noIndicator: string[] = [];
  let sameCount = 0;
  let last = "";
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const id = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      const s = getComputedStyle(el);
      const visible = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none") || s.textDecorationLine.includes("underline");
      return { id: `${id} "${(el.textContent ?? "").trim().slice(0, 30)}"`, visible: !!visible };
    });
    if (!info) continue;
    if (info.id === last) sameCount++;
    else sameCount = 0;
    last = info.id;
    if (!seen.has(info.id)) {
      seen.add(info.id);
      if (!info.visible) noIndicator.push(info.id);
    }
  }
  return { interactive, presses, reached: seen.size, noIndicator, trapped: sameCount >= 4 && interactive > 2 };
}

async function highlight(ctx: ScanContext, page: Page, selector: string, name: string): Promise<string | null> {
  try {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded({ timeout: 2000 });
    await el.evaluate((n) => ((n as HTMLElement).style.outline = "3px solid #ef4444"));
    const s = await ctx.shot(page, name);
    await el.evaluate((n) => ((n as HTMLElement).style.outline = ""));
    return s;
  } catch {
    return null;
  }
}

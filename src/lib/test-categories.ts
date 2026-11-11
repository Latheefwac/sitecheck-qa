// Which test categories a scan runs. Pure module, shared by the UI and the engine.
import type { Category, ScanOptions } from "./types";

/** Categories that can be switched on or off. Crawl & link checks always run, because discovery needs them. */
export const TESTABLE_CATEGORIES = [
  "seo",
  "performance",
  "accessibility",
  "functional",
  "forms",
  "responsive",
  "images",
  "animation",
  "integrations",
  "cross-browser",
  "security",
  "email",
] as const satisfies readonly Category[];
export type TestableCategory = (typeof TESTABLE_CATEGORIES)[number];

export const CATEGORY_INFO: Record<TestableCategory, { label: string; description: string }> = {
  seo: { label: "SEO", description: "Titles, meta, headings, canonical, Open Graph, JSON-LD, robots.txt, sitemap" },
  performance: { label: "Performance (PageSpeed)", description: "Lighthouse score and Core Web Vitals: FCP, LCP, CLS, TBT, TTFB" },
  accessibility: { label: "Accessibility", description: "axe-core rules at the level chosen below" },
  functional: { label: "Functional", description: "Navigation, menus, CTAs, carousels, tabs, modals, footer, 404 page" },
  forms: { label: "Forms", description: "Validation and error messages; submissions only if enabled in Settings" },
  responsive: { label: "Responsive", description: "Overflow, overlap, tap targets and screenshots at each viewport" },
  images: { label: "Images & Assets", description: "Alt text, file size, WebP/AVIF, lazy loading, dimensions, naming" },
  animation: { label: "Animation", description: "Scroll FPS, jank, layout shift, GSAP/Lottie health, reduced motion" },
  integrations: { label: "Google Integrations", description: "GTM, GA4 and reCAPTCHA set-up" },
  "cross-browser": { label: "Cross-Browser", description: "Firefox, Safari (WebKit) and Edge compared with Chrome" },
  security: { label: "Security & Technical", description: "HTTPS, headers, mixed content, exposed files, console errors" },
  email: { label: "Email Templates", description: "Reads a Mailpit/MailHog test inbox (needs Settings)" },
};

export const CATEGORY_PRESETS: { id: string; label: string; categories: readonly TestableCategory[] }[] = [
  { id: "all", label: "Everything", categories: TESTABLE_CATEGORIES },
  { id: "pagespeed", label: "PageSpeed set", categories: ["performance", "accessibility", "seo"] },
  { id: "handover", label: "UI handover", categories: ["seo", "performance", "accessibility", "functional", "forms", "responsive", "images", "security"] },
];

/** Categories the scan runs. Scans created before this option existed ran everything. */
export function categoriesOf(options: Pick<ScanOptions, "categories"> | null | undefined): TestableCategory[] {
  const c = options?.categories;
  if (!c?.length) return [...TESTABLE_CATEGORIES];
  return TESTABLE_CATEGORIES.filter((x) => c.includes(x));
}

export const isPartialScan = (options: Pick<ScanOptions, "categories"> | null | undefined) => categoriesOf(options).length < TESTABLE_CATEGORIES.length;

/** Short text such as "SEO, Performance (PageSpeed), Accessibility" or "All categories". */
export function categoriesText(options: Pick<ScanOptions, "categories"> | null | undefined): string {
  const c = categoriesOf(options);
  return c.length === TESTABLE_CATEGORIES.length ? "All categories" : c.map((x) => CATEGORY_INFO[x].label).join(", ");
}

/** Whether a result category runs in this scan. Crawl always does. */
export const runsCategory = (options: Pick<ScanOptions, "categories"> | null | undefined, c: Category) =>
  c === "crawl" || (categoriesOf(options) as Category[]).includes(c);

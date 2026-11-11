import type { A11yLevel } from "./a11y-levels";
import type { TestableCategory } from "./test-categories";
// Shared domain types used by both the backend engine and the UI.

export type TestStatus = "PASS" | "FAIL" | "WARNING" | "NOT_TESTED";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export type ScanMode = "quick" | "full";
export type ScanStatus =
  | "discovering"
  | "ready" // pages discovered, waiting for selection/start
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const CATEGORIES = [
  "crawl",
  "functional",
  "forms",
  "responsive",
  "images",
  "animation",
  "performance",
  "seo",
  "integrations",
  "accessibility",
  "email",
  "cross-browser",
  "security",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  crawl: "Crawl & Links",
  functional: "Functional",
  forms: "Forms",
  responsive: "Responsive",
  images: "Images & Assets",
  animation: "Animation",
  performance: "Performance",
  seo: "SEO",
  integrations: "Google Integrations",
  accessibility: "Accessibility",
  email: "Email Templates",
  "cross-browser": "Cross-Browser",
  security: "Security & Technical",
};

export const SCORE_GROUPS = [
  "functionality",
  "responsive",
  "performance",
  "seo",
  "accessibility",
  "assets",
  "animation",
  "technical",
] as const;
export type ScoreGroup = (typeof SCORE_GROUPS)[number];

export const SCORE_GROUP_LABELS: Record<ScoreGroup, string> = {
  functionality: "Functionality",
  responsive: "Responsive",
  performance: "Performance",
  seo: "SEO",
  accessibility: "Accessibility",
  assets: "Asset Optimization",
  animation: "Animation",
  technical: "Technical Health",
};

/** Which result categories feed which score group. */
export const CATEGORY_TO_GROUP: Record<Category, ScoreGroup> = {
  crawl: "technical",
  functional: "functionality",
  forms: "functionality",
  email: "functionality",
  responsive: "responsive",
  images: "assets",
  animation: "animation",
  performance: "performance",
  seo: "seo",
  integrations: "technical",
  accessibility: "accessibility",
  "cross-browser": "technical",
  security: "technical",
};

export interface TestResultInput {
  checkKey: string; // stable key, e.g. "seo.title" — used for comparisons
  category: Category;
  pageUrl: string;
  title: string;
  description: string;
  expected: string;
  actual: string;
  status: TestStatus;
  severity: Severity;
  screenshot?: string | null; // relative path under data/
  error?: string | null;
  recommendation?: string | null;
  viewport?: string | null;
  browser?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface TestResult extends TestResultInput {
  id: number;
  scanId: string;
  caseId: string;
  createdAt: string;
  resolved: boolean;
  assignee: string | null;
  comment: string | null;
  /** Developer workflow status, set from the admin UI or a project share link. */
  bugStatus: BugStatus;
  devComment: string | null;
  statusBy: string | null;
  statusAt: string | null;
}

/**
 * Developer-facing bug workflow. "fixed" is a developer's claim: it does not change the score or the
 * handover decision. Only a re-run (the issue now passes) or QA marking it resolved does.
 */
export const BUG_STATUSES = ["open", "in_progress", "fixed", "needs_info", "wont_fix"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  fixed: "Fixed – ready for retest",
  needs_info: "Needs info",
  wont_fix: "Won't fix",
};

export interface ShareLink {
  id: string;
  websiteId: number;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  /** Full URL path (/share/<token>); only returned to the admin API. */
  path: string;
}

export interface Project {
  id: number;
  origin: string;
  createdAt: string;
  scanCount: number;
  latestScan: { id: string; status: string; createdAt: string; overall: number | null; handoverStatus: string | null; a11yLevel: A11yLevel; categories: TestableCategory[] } | null;
  activeLinks: number;
}

export interface AuthConfig {
  type: "none" | "basic" | "cookie" | "form";
  username?: string;
  password?: string;
  cookie?: string; // raw "a=b; c=d"
  headers?: Record<string, string>;
  loginUrl?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

export interface ScanOptions {
  mode: ScanMode;
  maxPages: number;
  maxDepth: number;
  useSitemap: boolean;
  manualUrls: string[];
  autoStart: boolean;
  browsers: BrowserName[];
  /** Expected production base URL for canonical checks, e.g. https://www.example.com */
  productionBaseUrl?: string;
  /** Accessibility conformance level the project is tested against. Missing on old scans = "wcag-aa". */
  a11yLevel?: A11yLevel;
  /** Test categories to run (crawl always runs). Missing on old scans = all. */
  categories?: TestableCategory[];
}

export type BrowserName = "chromium" | "firefox" | "webkit" | "msedge";

export interface CategoryScores {
  groups: Record<ScoreGroup, number | null>;
  overall: number;
  productionReady: boolean;
  handoverStatus: "READY FOR QA" | "READY WITH WARNINGS" | "NOT READY";
  blockers: string[];
}

export interface ScanSummary {
  pages: number;
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  notTested: number;
  critical: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, { pass: number; fail: number; warning: number; notTested: number }>;
}

export interface Scan {
  id: string;
  websiteId: number;
  url: string;
  mode: ScanMode;
  status: ScanStatus;
  phase: string | null;
  progress: number;
  options: ScanOptions;
  hasAuth: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  scores: CategoryScores | null;
  summary: ScanSummary | null;
  error: string | null;
  baselineScanId: string | null;
}

export interface PageRecord {
  id: number;
  scanId: string;
  url: string;
  statusCode: number | null;
  redirectTo: string | null;
  contentType: string | null;
  title: string | null;
  depth: number;
  source: "crawl" | "sitemap" | "manual" | "seed";
  selected: boolean;
  isInternal: boolean;
  error: string | null;
}

export interface LinkRecord {
  fromUrl: string;
  toUrl: string;
  statusCode: number | null;
  kind: "internal" | "external";
  redirectedTo: string | null;
  error: string | null;
}

export interface ScreenshotRecord {
  id: number;
  scanId: string;
  pageUrl: string;
  viewport: string;
  browser: string;
  path: string;
  diffPath: string | null;
  diffRatio: number | null;
}

export interface Settings {
  weights: Record<ScoreGroup, number>;
  productionThreshold: number; // overall score needed for "ready"
  maxHighIssuesForReady: number;
  imageMaxKb: number;
  imageWarnKb: number;
  lighthousePageLimit: number; // full scan: max pages to run Lighthouse on
  pageTimeoutMs: number;
  concurrency: number;
  allowFormSubmission: boolean; // only enable against test/staging environments
  formTestData: { name: string; email: string; phone: string; message: string };
  gtmContainerId: string;
  ga4MeasurementId: string;
  expectedDataLayerEvents: string[];
  recaptchaVerifyEndpoint: string; // authorized test endpoint that validates tokens server-side
  cruxApiKey: string; // optional, for INP field data
  emailTestApi: string; // Mailpit-compatible base URL, e.g. http://localhost:8025
  emailExpectedSubject: string;
  emailExpectedSender: string;
  emailAdminRecipient: string;
}

export const DEFAULT_SETTINGS: Settings = {
  weights: {
    functionality: 20,
    responsive: 15,
    performance: 15,
    seo: 12,
    accessibility: 15,
    assets: 8,
    animation: 5,
    technical: 10,
  },
  productionThreshold: 85,
  maxHighIssuesForReady: 0,
  imageMaxKb: 500,
  imageWarnKb: 200,
  lighthousePageLimit: 5,
  pageTimeoutMs: 30000,
  concurrency: 1,
  allowFormSubmission: false,
  formTestData: {
    name: "QA Automation",
    email: "qa-automation@example.test",
    phone: "+15555550100",
    message: "Automated QA test submission — please ignore.",
  },
  gtmContainerId: "",
  ga4MeasurementId: "",
  expectedDataLayerEvents: [],
  recaptchaVerifyEndpoint: "",
  cruxApiKey: "",
  emailTestApi: "",
  emailExpectedSubject: "",
  emailExpectedSender: "",
  emailAdminRecipient: "",
};

export const VIEWPORTS = [
  { name: "desktop-1920", width: 1920, height: 1080, group: "Desktop" },
  { name: "desktop-1440", width: 1440, height: 900, group: "Desktop" },
  { name: "desktop-1366", width: 1366, height: 768, group: "Desktop" },
  { name: "laptop-1280", width: 1280, height: 800, group: "Laptop" },
  { name: "tablet-1024", width: 1024, height: 1366, group: "Tablet" },
  { name: "tablet-768", width: 768, height: 1024, group: "Tablet" },
  { name: "mobile-430", width: 430, height: 932, group: "Mobile" },
  { name: "mobile-390", width: 390, height: 844, group: "Mobile" },
  { name: "mobile-375", width: 375, height: 812, group: "Mobile" },
  { name: "mobile-360", width: 360, height: 800, group: "Mobile" },
] as const;
export type Viewport = (typeof VIEWPORTS)[number];
export const QUICK_VIEWPORTS = ["desktop-1440", "tablet-768", "mobile-390"];

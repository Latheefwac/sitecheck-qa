import "server-only";
import type { BugStatus, Category, Severity, TestResult, TestStatus } from "../types";

/** The only result fields a developer share link ever sees. No meta, logs, options or credentials. */
export interface DevIssue {
  id: number; caseId: string; category: Category; pageUrl: string; title: string; description: string; expected: string; actual: string;
  status: TestStatus; severity: Severity; screenshot: string | null; error: string | null; recommendation: string | null;
  viewport: string | null; browser: string | null; createdAt: string; resolved: boolean; assignee: string | null; qaComment: string | null;
  bugStatus: BugStatus; devComment: string | null; statusBy: string | null; statusAt: string | null;
}

export function toDevIssue(r: TestResult, token: string): DevIssue {
  return {
    id: r.id, caseId: r.caseId, category: r.category, pageUrl: r.pageUrl, title: r.title, description: r.description, expected: r.expected,
    actual: r.actual, status: r.status, severity: r.severity,
    screenshot: r.screenshot ? `/api/share/${token}/files/${r.screenshot.split("/").map(encodeURIComponent).join("/")}` : null,
    error: r.error ?? null, recommendation: r.recommendation ?? null, viewport: r.viewport ?? null, browser: r.browser ?? null, createdAt: r.createdAt,
    resolved: r.resolved, assignee: r.assignee, qaComment: r.comment, bugStatus: r.bugStatus, devComment: r.devComment, statusBy: r.statusBy, statusAt: r.statusAt,
  };
}

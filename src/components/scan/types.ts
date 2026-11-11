import type { PageRecord, Scan, ScreenshotRecord, TestResult } from "@/lib/types";

export interface ScanDetail {
  scan: Scan;
  pages: PageRecord[];
  results: TestResult[];
  screenshots: ScreenshotRecord[];
  logs: { id: number; ts: string; level: string; message: string }[];
  linkStats: { internal: number; external: number; broken: number; redirects: number };
  queuePosition: number;
}

import { connection, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createScan, listScans } from "@/lib/server/db";
import { enqueue } from "@/lib/server/jobs";
import { encryptAuth } from "@/lib/server/secrets";
import { validateUrl } from "@/lib/url";
import type { ScanOptions } from "@/lib/types";
import { A11Y_LEVELS } from "@/lib/a11y-levels";
import { TESTABLE_CATEGORIES } from "@/lib/test-categories";

const Body = z.object({
  url: z.string().min(1),
  mode: z.enum(["quick", "full"]).default("quick"),
  maxPages: z.number().int().min(1).max(500).default(20),
  maxDepth: z.number().int().min(0).max(10).default(3),
  useSitemap: z.boolean().default(true),
  manualUrls: z.array(z.string()).max(200).default([]),
  autoStart: z.boolean().default(false),
  browsers: z.array(z.enum(["chromium", "firefox", "webkit", "msedge"])).default(["chromium", "firefox", "webkit"]),
  productionBaseUrl: z.string().optional(),
  a11yLevel: z.enum(A11Y_LEVELS).default("basic"),
  categories: z.array(z.enum(TESTABLE_CATEGORIES)).min(1, "Choose at least one test category").default([...TESTABLE_CATEGORIES]),
  auth: z
    .object({
      type: z.enum(["none", "basic", "cookie", "form"]),
      username: z.string().optional(),
      password: z.string().optional(),
      cookie: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      loginUrl: z.string().optional(),
      usernameSelector: z.string().optional(),
      passwordSelector: z.string().optional(),
      submitSelector: z.string().optional(),
    })
    .optional(),
});

export async function GET() {
  await connection();
  return NextResponse.json(listScans(200));
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const b = parsed.data;
  const v = validateUrl(b.url);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  let prod: string | undefined;
  if (b.productionBaseUrl?.trim()) {
    const pv = validateUrl(b.productionBaseUrl);
    if (!pv.ok) return NextResponse.json({ error: `Production URL: ${pv.error}` }, { status: 400 });
    prod = pv.url.replace(/\/$/, "");
  }
  const options: ScanOptions = { mode: b.mode, maxPages: b.maxPages, maxDepth: b.maxDepth, useSitemap: b.useSitemap, manualUrls: b.manualUrls.filter(Boolean), autoStart: b.autoStart, browsers: b.browsers, productionBaseUrl: prod, a11yLevel: b.a11yLevel, categories: TESTABLE_CATEGORIES.filter((c) => b.categories.includes(c)) };
  const authEnc = b.auth && b.auth.type !== "none" ? encryptAuth(b.auth) : null;
  const scan = createScan(nanoid(10), v.url, options, authEnc);
  enqueue({ kind: "discover", scanId: scan.id, then: b.autoStart ? "test" : undefined });
  return NextResponse.json(scan, { status: 201 });
}

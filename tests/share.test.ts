import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Each run gets its own throwaway database.
process.env.QA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "qa-share-"));
process.env.QA_SECRET_KEY = "test-key";

type Db = typeof import("@/lib/server/db");
type Share = typeof import("@/lib/server/share");
let db: Db;
let share: Share;
const opts = { mode: "quick" } as Parameters<Db["createScan"]>[2];
const input = (title: string) => ({ checkKey: "x", category: "seo" as const, pageUrl: "https://a.com/", title, description: "d", expected: "e", actual: "a", status: "FAIL" as const, severity: "High" as const });

beforeAll(async () => {
  db = await import("@/lib/server/db");
  share = await import("@/lib/server/share");
});

describe("project share links", () => {
  it("resolves only active tokens and scopes results to their own project", () => {
    const a = db.createScan("scanA", "https://a.com/", opts, null);
    const b = db.createScan("scanB", "https://b.com/", opts, null);
    const ra = db.insertResult(a.id, input("A issue"));
    const rb = db.insertResult(b.id, input("B issue"));

    const link = share.createShareLink(a.websiteId, "Priya", 30);
    const token = link.path.split("/").pop()!;
    const resolved = share.resolveShareToken(token);
    expect(resolved?.websiteId).toBe(a.websiteId);
    expect(resolved?.origin).toBe("https://a.com");

    expect(share.resultInProject(ra, a.websiteId)?.id).toBe(ra);
    expect(share.resultInProject(rb, a.websiteId)).toBeNull();
    expect(share.scanInProject(b.id, a.websiteId)).toBe(false);

    expect(share.resolveShareToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(share.resolveShareToken("../../etc")).toBeNull();

    share.revokeShareLink(link.id);
    expect(share.resolveShareToken(token)).toBeNull();
  });

  it("rejects expired links", () => {
    const s = db.createScan("scanC", "https://c.com/", opts, null);
    const link = share.createShareLink(s.websiteId, "Sam", 1);
    db.db().prepare("UPDATE share_links SET expires_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), link.id);
    expect(share.resolveShareToken(link.path.split("/").pop()!)).toBeNull();
  });

  it("records developer status changes without touching QA resolution", () => {
    const s = db.createScan("scanD", "https://d.com/", opts, null);
    const id = db.insertResult(s.id, input("D issue"));
    db.updateResult(id, { bugStatus: "fixed", devComment: "Fixed in PR 12" }, { name: "Priya", via: "share" });
    const r = db.getResult(id)!;
    expect(r.bugStatus).toBe("fixed");
    expect(r.statusBy).toBe("Priya");
    expect(r.resolved).toBe(false);
    const act = db.listActivity(id);
    expect(act[0]).toMatchObject({ actor: "Priya", via: "share", fromStatus: "open", toStatus: "fixed", note: "Fixed in PR 12" });
  });
});

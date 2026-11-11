import "server-only";
import crypto from "node:crypto";
import { db, getResult, getScan, getWebsite } from "./db";
import { decryptText, encryptText } from "./secrets";
import type { ShareLink } from "../types";

// Project share links give a developer access to ONE website's issues, and only allow them to change the
// developer bug status and leave a note. The raw token is 256 bits of randomness. It is looked up by its
// SHA-256 hash and kept encrypted so an admin can copy the link again later.

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const now = () => new Date().toISOString();

type Row = { id: string; website_id: number; label: string; token_enc: string; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null };
const toLink = (r: Row): ShareLink => ({
  id: r.id, websiteId: r.website_id, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at,
  lastUsedAt: r.last_used_at, path: `/share/${decryptText(r.token_enc)}`,
});

export function createShareLink(websiteId: number, label: string, expiresInDays: number | null): ShareLink {
  if (!getWebsite(websiteId)) throw new Error("Project not found");
  const token = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomBytes(8).toString("hex");
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null;
  db().prepare("INSERT INTO share_links(id, website_id, label, token_hash, token_enc, created_at, expires_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, websiteId, label, hash(token), encryptText(token), now(), expiresAt);
  return toLink(db().prepare("SELECT * FROM share_links WHERE id=?").get(id) as Row);
}

export function listShareLinks(websiteId: number): ShareLink[] {
  return (db().prepare("SELECT * FROM share_links WHERE website_id=? ORDER BY created_at DESC").all(websiteId) as Row[]).map(toLink);
}

export function revokeShareLink(id: string) {
  db().prepare("UPDATE share_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(now(), id);
}

/** Returns the active link for a raw token, or null if unknown, revoked or expired. */
export function resolveShareToken(token: string): (ShareLink & { origin: string }) | null {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const r = db().prepare("SELECT * FROM share_links WHERE token_hash=?").get(hash(token)) as Row | undefined;
  if (!r || r.revoked_at || (r.expires_at && r.expires_at <= now())) return null;
  const site = getWebsite(r.website_id);
  if (!site) return null;
  db().prepare("UPDATE share_links SET last_used_at=? WHERE id=?").run(now(), r.id);
  return { ...toLink(r), origin: site.origin };
}

/** True only when the scan belongs to the link's project. Every share route checks this. */
export function scanInProject(scanId: string, websiteId: number): boolean {
  return getScan(scanId)?.websiteId === websiteId;
}
export function resultInProject(resultId: number, websiteId: number) {
  const r = getResult(resultId);
  return r && scanInProject(r.scanId, websiteId) ? r : null;
}

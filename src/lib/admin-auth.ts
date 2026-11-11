// Optional admin gate. When QA_ADMIN_PASSWORD is set, everything except developer share links
// (/share/…, /api/share/…) and the login page requires the admin session cookie.
// Kept free of "server-only" so proxy.ts can import it; it is never imported by client code.
import crypto from "node:crypto";

export const ADMIN_COOKIE = "sitecheck_admin";
export const adminGateEnabled = () => !!process.env.QA_ADMIN_PASSWORD;

/** Session value derived from the password, so changing the password signs everyone out. */
export function adminSessionValue(): string | null {
  const pw = process.env.QA_ADMIN_PASSWORD;
  return pw ? crypto.createHmac("sha256", pw).update("sitecheck-admin-session-v1").digest("base64url") : null;
}

export function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

export function isAdminCookie(value: string | undefined): boolean {
  const expected = adminSessionValue();
  if (!expected) return true; // gate disabled
  return !!value && safeEqual(value, expected);
}

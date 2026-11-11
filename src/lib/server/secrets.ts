import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";
import type { AuthConfig } from "../types";

// Credentials for authenticated scans are encrypted at rest with AES-256-GCM and are never
// returned by any API route or written into reports.
function key(): Buffer {
  const env = process.env.QA_SECRET_KEY;
  if (env) return crypto.createHash("sha256").update(env).digest();
  const file = path.join(DATA_DIR, ".secret-key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

export function encryptAuth(auth: AuthConfig): string {
  return encryptText(JSON.stringify(auth));
}

export function decryptAuth(blob: string | null): AuthConfig | null {
  return blob ? (JSON.parse(decryptText(blob)) as AuthConfig) : null;
}

export function encryptText(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptText(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** Redacts anything that looks like a secret before it reaches a browser-side report. */
export function redact(text: string): string {
  return text
    .replace(/(secret|password|passwd|api[_-]?key|token|authorization)(["'\s:=]+)([^\s"'&,;]{4,})/gi, "$1$2[REDACTED]")
    .replace(/\b(sk_live_|rk_live_)[A-Za-z0-9]{8,}/g, "$1[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA[REDACTED]");
}

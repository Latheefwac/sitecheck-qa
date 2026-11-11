import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
export const scoreColor = (v: number | null | undefined) => (v === null || v === undefined ? "text-muted-foreground" : v >= 90 ? "text-pass" : v >= 70 ? "text-warn" : "text-fail");
export const scoreFill = (v: number | null | undefined) => (v === null || v === undefined ? "var(--neutral)" : v >= 90 ? "var(--pass)" : v >= 70 ? "var(--warn)" : "var(--fail)");
export const fileUrl = (rel?: string | null) => (rel ? `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}` : null);

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Request failed (${r.status})`);
  return j as T;
}

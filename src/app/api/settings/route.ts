import { connection, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/server/db";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

const MASK = "••••••••";
const mask = (s: Settings): Settings => ({ ...s, cruxApiKey: s.cruxApiKey ? MASK + s.cruxApiKey.slice(-4) : "" });

export async function GET() {
  await connection();
  return NextResponse.json(mask(getSettings()));
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<Settings> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const cur = getSettings();
  const next: Settings = { ...cur };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== typeof DEFAULT_SETTINGS[k]) return NextResponse.json({ error: `Invalid type for ${k}` }, { status: 400 });
    (next as unknown as Record<string, unknown>)[k] = body[k];
  }
  if (typeof body.cruxApiKey === "string" && body.cruxApiKey.startsWith(MASK)) next.cruxApiKey = cur.cruxApiKey;
  for (const [k, v] of Object.entries(next.weights)) if (typeof v !== "number" || v < 0 || v > 100) return NextResponse.json({ error: `Weight ${k} must be 0–100` }, { status: 400 });
  next.concurrency = Math.min(4, Math.max(1, Math.round(next.concurrency)));
  saveSettings(next);
  return NextResponse.json(mask(next));
}

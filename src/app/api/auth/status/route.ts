import { NextResponse, connection } from "next/server";
import { adminGateEnabled } from "@/lib/admin-auth";

export async function GET() {
  await connection();
  return NextResponse.json({ gate: adminGateEnabled() });
}

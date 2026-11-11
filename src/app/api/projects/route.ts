import { NextResponse } from "next/server";
import { connection } from "next/server";
import { listProjects } from "@/lib/server/db";
import { adminGateEnabled } from "@/lib/admin-auth";

export async function GET() {
  await connection();
  return NextResponse.json({ projects: listProjects(), adminGate: adminGateEnabled() });
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lightweight liveness probe used by Docker/Coolify healthchecks.
export async function GET() {
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}

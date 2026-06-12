// HOA-validator endpoint, background-job + poll style (immune to reverse-proxy
// response timeouts — no long-lived connection):
//   POST  → start the research job in the background, return immediately (202)
//   GET   → report the current stage / result for the polling client
// The job runs in the persistent Node server after POST responds; progress is
// kept in an in-memory store (src/lib/hoa-jobs.ts) and the final findings are
// written to hoa_details. Auth is enforced by middleware. The no-JS fallback is
// the researchHoaAction server action.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { properties } from "@/db/schema";
import { formatAddress } from "@/lib/geocode";
import { researchHoa, type HoaResearchInput } from "@/lib/hoa";
import { persistHoaResearch } from "@/lib/hoa-persist";
import { getJob, isRunning, startJob, updateJob } from "@/lib/hoa-jobs";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ state: "idle" });
  return Response.json({
    state: job.state,
    stage: job.stage,
    searchIndex: job.searchIndex,
    message: job.message,
    rating: job.rating,
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Already working on it — don't start a duplicate; the client just polls.
  if (isRunning(id)) {
    return Response.json({ state: "running" }, { status: 202 });
  }

  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop) return Response.json({ error: "not-found" }, { status: 404 });
  if (!prop.address?.trim()) {
    return Response.json({ error: "no-address" }, { status: 400 });
  }

  startJob(id);

  // Fire-and-forget: keeps running in the persistent Node server after we
  // respond. The client polls GET for progress and the final result.
  void runJob(id, {
    address: formatAddress({
      address: prop.address,
      city: prop.city,
      state: prop.state,
      zip: prop.zip,
    }),
    hoaName: prop.communityHoa,
    knownFeeMonthly: prop.hoaMonthly == null ? null : Number(prop.hoaMonthly),
    listingText: prop.listingDescription,
  });

  return Response.json({ state: "running" }, { status: 202 });
}

async function runJob(id: string, input: HoaResearchInput): Promise<void> {
  try {
    const { data, model } = await researchHoa(input, (p) =>
      updateJob(id, { stage: p.stage, searchIndex: p.searchIndex }),
    );
    updateJob(id, { stage: "saving" });
    await persistHoaResearch(id, data, model);
    updateJob(id, {
      state: "done",
      stage: "done",
      rating: data.rating == null ? null : Number(data.rating),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "HOA research failed";
    logError("hoa", "HOA research job failed", { id, error: e });
    updateJob(id, { state: "error", message });
  }
}

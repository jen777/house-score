// Streaming HOA-validator endpoint. Runs the web-research pipeline and streams
// coarse progress stages (searching → reading → writing → saving → done) back
// to the browser as newline-delimited JSON, so the UI can show what stage it's
// on. Auth is enforced by middleware (the session cookie is sent with the
// request). The no-JS fallback remains the researchHoaAction server action.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { properties } from "@/db/schema";
import { formatAddress } from "@/lib/geocode";
import { researchHoa } from "@/lib/hoa";
import { persistHoaResearch } from "@/lib/hoa-persist";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  if (!prop.address?.trim()) {
    return Response.json({ error: "no-address" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // Client went away mid-stream; stop trying to write.
          closed = true;
        }
      };

      // Web search runs server-side with no bytes flowing for stretches; a
      // heartbeat keeps proxies from idle-timing-out the connection before the
      // "done" event arrives.
      const heartbeat = setInterval(() => send({ type: "ping" }), 10000);

      try {
        send({ type: "progress", stage: "starting" });

        const fullAddress = formatAddress({
          address: prop.address,
          city: prop.city,
          state: prop.state,
          zip: prop.zip,
        });

        const { data, model } = await researchHoa(
          {
            address: fullAddress,
            hoaName: prop.communityHoa,
            knownFeeMonthly:
              prop.hoaMonthly == null ? null : Number(prop.hoaMonthly),
            listingText: prop.listingDescription,
          },
          (p) =>
            send({
              type: "progress",
              stage: p.stage,
              searchIndex: p.searchIndex,
            }),
        );

        send({ type: "progress", stage: "saving" });
        await persistHoaResearch(id, data, model);
        revalidatePath(`/properties/${id}`);

        send({
          type: "done",
          rating: data.rating,
          confidence: data.confidence,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "HOA research failed";
        logError("hoa", "HOA research route failed", { id, error: e });
        send({ type: "error", message });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the client disconnected.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Disable proxy buffering so stages arrive incrementally.
      "X-Accel-Buffering": "no",
    },
  });
}

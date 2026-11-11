import { bus, type ScanEvent } from "@/lib/server/engine/context";
import { getScan } from "@/lib/server/db";

// Server-Sent Events stream for real-time progress.
export async function GET(req: Request, ctx: RouteContext<"/api/scans/[id]/events">) {
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const s = getScan(id);
      send({ type: "progress", scanId: id, progress: s?.progress ?? 0, phase: s?.phase ?? "" });
      const onEvent = (e: ScanEvent) => send(e);
      bus.on(`scan:${id}`, onEvent);
      const ping = setInterval(() => controller.enqueue(enc.encode(`: ping\n\n`)), 15000);
      cleanup = () => {
        clearInterval(ping);
        bus.off(`scan:${id}`, onEvent);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

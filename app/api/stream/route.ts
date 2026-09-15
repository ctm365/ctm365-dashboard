import { openCustomerReadingStream } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temporary until Cognito auth is added. After that, this value must come
 * from the verified session (getSession().customerId), and the route must
 * return 401 when there is no session.
 */
const DEMO_CUSTOMER_ID = "demo";

export async function GET(request: Request) {
  const readings = await openCustomerReadingStream(DEMO_CUSTOMER_ID);
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("snapshot", readings.history);
      const unsubscribe = readings.subscribe((batch) => send("readings", batch));

      // Comment line every 15 s keeps proxies from closing an idle connection.
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15000);

      cleanup = () => {
        unsubscribe();
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

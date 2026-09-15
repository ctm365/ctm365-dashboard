import { getSession } from "@/lib/auth/session";
import { streamCustomerReadings } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Middleware is only a convenience redirect; this route verifies the session itself.
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!session.customerId) {
    return Response.json({ error: "Account not configured" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const readings = await streamCustomerReadings(session.customerId);
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

      // End the stream when the ID token expires. EventSource reconnects, and
      // that request re-checks (and refreshes) the session.
      const sessionExpiry = setTimeout(() => cleanup(), Math.max(0, session.expiresAt - Date.now()));

      cleanup = () => {
        unsubscribe();
        clearInterval(keepAlive);
        clearTimeout(sessionExpiry);
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

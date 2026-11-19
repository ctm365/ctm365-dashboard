import { getSession } from "@/lib/auth/session";
import { getHvacData } from "@/lib/hvac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  // Middleware is only a convenience redirect; this route verifies the session itself.
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (!session.customerId) {
    return Response.json({ error: "Account not configured" }, { status: 403, headers: NO_STORE });
  }

  const hours = Number(new URL(request.url).searchParams.get("hours") ?? "24");
  try {
    const units = await getHvacData(session.customerId, Number.isFinite(hours) ? hours : 24);
    return Response.json({ units }, { headers: NO_STORE });
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(`[hvac] read failed: ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Couldn't load HVAC data" }, { status: 500, headers: NO_STORE });
  }
}

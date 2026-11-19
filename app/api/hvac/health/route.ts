import { getSession } from "@/lib/auth/session";
import { getHvacHealth } from "@/lib/hvac-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  // Middleware is only a convenience redirect; this route verifies the session itself.
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (!session.customerId) return Response.json({ error: "Account not configured" }, { status: 403, headers: NO_STORE });
  try {
    const units = await getHvacHealth(session.customerId);
    if (!units) return Response.json({ error: "HVAC monitoring isn't enabled for this account" }, { status: 403, headers: NO_STORE });
    return Response.json({ units }, { headers: NO_STORE });
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(`[hvac-health] read failed: ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Couldn't load HVAC health" }, { status: 500, headers: NO_STORE });
  }
}

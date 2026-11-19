import { getSession } from "@/lib/auth/session";
import { getPowerView } from "@/lib/power";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  // Middleware is only a convenience redirect; this route verifies the session itself.
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (!session.customerId) return Response.json({ error: "Account not configured" }, { status: 403, headers: NO_STORE });
  try {
    const view = await getPowerView(session.customerId);
    if (!view) {
      return Response.json({ error: "Power monitoring isn't enabled for this account" }, { status: 403, headers: NO_STORE });
    }
    return Response.json(view, { headers: NO_STORE });
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(`[power] read failed: ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Couldn't load power readings" }, { status: 500, headers: NO_STORE });
  }
}

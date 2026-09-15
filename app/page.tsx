import { Dashboard } from "@/components/dashboard/dashboard";
import { LiveFleetProvider } from "@/lib/live-fleet";
import { getCustomerSite } from "@/lib/telemetry";

/**
 * Temporary until Cognito auth is added. After that, customerId comes from
 * the verified session, and signed-out visitors are redirected to /login.
 */
const DEMO_CUSTOMER_ID = "demo";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const site = await getCustomerSite(DEMO_CUSTOMER_ID);
  return (
    <LiveFleetProvider site={site}>
      <Dashboard />
    </LiveFleetProvider>
  );
}

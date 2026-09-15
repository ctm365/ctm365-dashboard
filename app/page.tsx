import { AccountNotConfigured } from "@/components/auth/account-not-configured";
import { Dashboard } from "@/components/dashboard/dashboard";
import { isAdmin, requireSession } from "@/lib/auth/session";
import { LiveFleetProvider } from "@/lib/live-fleet";
import { getCustomerSite } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireSession("/");
  if (!session.customerId) {
    return <AccountNotConfigured email={session.email} showAdminLink={isAdmin(session)} />;
  }

  const site = await getCustomerSite(session.customerId);
  return (
    <LiveFleetProvider site={site}>
      <Dashboard userEmail={session.email} showAdminLink={isAdmin(session)} />
    </LiveFleetProvider>
  );
}

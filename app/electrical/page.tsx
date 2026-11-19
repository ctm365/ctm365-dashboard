import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountNotConfigured } from "@/components/auth/account-not-configured";
import { ConnectionStatus } from "@/components/dashboard/connection-status";
import { ElectricalDashboard } from "@/components/dashboard/electrical-dashboard";
import { SiteHeader } from "@/components/dashboard/site-header";
import { isAdmin, requireSession } from "@/lib/auth/session";
import { LiveFleetProvider } from "@/lib/live-fleet";
import { enabledServices } from "@/lib/services";
import { getCustomerSite } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Electrical · CTM365",
};

export default async function ElectricalPage() {
  const session = await requireSession("/electrical");
  if (!session.customerId) {
    return <AccountNotConfigured email={session.email} showAdminLink={isAdmin(session)} />;
  }

  const site = await getCustomerSite(session.customerId);
  // Not one of this customer's services: "/" sends them to one that is.
  if (!site.services.electrical) redirect("/");

  return (
    <LiveFleetProvider site={site}>
      <div className="flex min-h-screen flex-col">
        <SiteHeader
          siteName={site.name}
          tabs={enabledServices(site.services)}
          active="electrical"
          status={<ConnectionStatus />}
          userEmail={session.email}
          showAdminLink={isAdmin(session)}
        />
        <ElectricalDashboard />
      </div>
    </LiveFleetProvider>
  );
}

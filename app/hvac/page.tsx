import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountNotConfigured } from "@/components/auth/account-not-configured";
import { EmptyState } from "@/components/dashboard/empty-state";
import { HvacSection } from "@/components/dashboard/hvac-section";
import { SiteHeader } from "@/components/dashboard/site-header";
import { isAdmin, requireSession } from "@/lib/auth/session";
import { enabledServices } from "@/lib/services";
import { getCustomerSite } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HVAC · CTM365",
};

export default async function HvacPage() {
  const session = await requireSession("/hvac");
  if (!session.customerId) {
    return <AccountNotConfigured email={session.email} showAdminLink={isAdmin(session)} />;
  }

  const site = await getCustomerSite(session.customerId);
  // Not one of this customer's services: "/" sends them to one that is.
  if (!site.services.hvac) redirect("/");

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        siteName={site.name}
        tabs={enabledServices(site.services)}
        active="hvac"
        userEmail={session.email}
        showAdminLink={isAdmin(session)}
      />
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        {site.hvacUnits.length === 0 ? (
          <EmptyState title="No HVAC units configured yet">
            Your site&apos;s HVAC units haven&apos;t been set up. Contact your CTM365 administrator.
          </EmptyState>
        ) : (
          <HvacSection units={site.hvacUnits} sample={site.hvacSampleData} />
        )}
      </main>
    </div>
  );
}

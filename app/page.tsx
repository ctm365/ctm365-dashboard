import { redirect } from "next/navigation";
import { AccountNotConfigured } from "@/components/auth/account-not-configured";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SiteHeader } from "@/components/dashboard/site-header";
import { isAdmin, requireSession } from "@/lib/auth/session";
import { enabledServices } from "@/lib/services";
import { getCustomerSite } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

/** Sends each customer to their first service. Customers with none see a short message. */
export default async function HomePage() {
  const session = await requireSession("/");
  if (!session.customerId) {
    return <AccountNotConfigured email={session.email} showAdminLink={isAdmin(session)} />;
  }

  const site = await getCustomerSite(session.customerId);
  const services = enabledServices(site.services);
  if (services.length > 0) redirect(services[0].path);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader siteName={site.name} tabs={[]} userEmail={session.email} showAdminLink={isAdmin(session)} />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        <EmptyState title="Monitoring isn't set up yet">
          Your CTM365 monitoring hasn&apos;t been turned on. Contact your CTM365 administrator.
        </EmptyState>
      </main>
    </div>
  );
}

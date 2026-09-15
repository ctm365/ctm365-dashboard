import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { ConfigEditor } from "@/components/admin/config-editor";
import { requireAdmin } from "@/lib/auth/session";
import { getCustomerConfig } from "@/lib/config/store";
import { isValidCustomerId } from "@/lib/config/validation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit customer · CTM365 Admin",
};

export default async function CustomerConfigPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const valid = isValidCustomerId(customerId);
  // Auth first, so nothing about this URL is revealed to non-admins.
  const session = await requireAdmin(valid ? `/admin/${customerId}` : "/admin");
  if (!valid) notFound();

  const config = await getCustomerConfig(customerId);
  if (!config) notFound();

  return (
    <AdminShell email={session.email}>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href="/admin" className="text-brand hover:underline">
          Customers
        </Link>{" "}
        / <span className="tabular text-ink">{customerId}</span>
      </nav>
      {/* key resets editor state if the admin navigates between customers. */}
      <ConfigEditor key={customerId} initialConfig={config} />
    </AdminShell>
  );
}

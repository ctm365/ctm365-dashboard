import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { NewCustomerForm } from "@/components/admin/new-customer-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { listCustomerConfigs } from "@/lib/config/store";
import type { CustomerConfig } from "@/lib/config/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Customers · CTM365 Admin",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function AdminPage() {
  const session = await requireAdmin("/admin");

  let customers: CustomerConfig[] | null = null;
  try {
    customers = (await listCustomerConfigs()).sort((a, b) => a.customerId.localeCompare(b.customerId));
  } catch (err) {
    console.error(`[admin] listCustomerConfigs failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }

  return (
    <AdminShell email={session.email}>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="text-xl">Customers</span>
            </CardTitle>
            {customers && <span className="text-xs text-muted">{plural(customers.length, "customer")}</span>}
          </CardHeader>
          {customers === null ? (
            <CardContent>
              <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">
                Couldn&apos;t load customers from DynamoDB. Check the server log and its AWS permissions.
              </p>
            </CardContent>
          ) : customers.length === 0 ? (
            <CardContent>
              <p className="text-sm text-muted">No customers yet. Add one below.</p>
            </CardContent>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {customers.map((c) => (
                <li key={c.customerId}>
                  <Link
                    href={`/admin/${c.customerId}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-sunken"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium text-ink">{c.siteName || "Unnamed site"}</span>
                      <span className="tabular text-xs text-muted">{c.customerId}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {plural(c.assets.length, "asset")} · {plural(c.sensors.length, "sensor")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add customer</CardTitle>
          </CardHeader>
          <CardContent>
            <NewCustomerForm />
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}

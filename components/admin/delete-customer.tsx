"use client";

import { useActionState, useState } from "react";
import { deleteCustomer, type DeleteCustomerState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Deletes the customer's setup. The admin types the exact ID to confirm,
 * so a mis-click can't remove a customer.
 */
export function DeleteCustomer({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState<DeleteCustomerState, FormData>(
    deleteCustomer.bind(null, customerId),
    {},
  );
  const matches = typed === customerId;

  return (
    <Card className="border-critical/40">
      <CardHeader className="flex-col items-start gap-1 border-b border-line pb-3">
        <CardTitle>Delete customer</CardTitle>
        <p className="text-sm text-muted">
          Removes this customer&apos;s site name, services, assets, sensors and HVAC units. Their readings and their
          sign-in accounts are kept, but those accounts will see &ldquo;Monitoring isn&apos;t set up yet&rdquo; until
          they&apos;re linked to another customer. A deleted customer can be restored from backup for 35 days.
        </p>
      </CardHeader>

      <div className="px-5 py-4">
        {!open ? (
          <Button variant="secondary" className="text-critical!" onClick={() => setOpen(true)}>
            Delete this customer…
          </Button>
        ) : (
          <form action={formAction} className="flex flex-col gap-2">
            <label htmlFor="delete-confirm" className="text-sm text-ink">
              Type <span className="tabular rounded bg-sunken px-1 font-medium">{customerId}</span> to confirm
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="delete-confirm"
                name="confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                className="h-9 min-w-0 flex-1 basis-56 rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:border-critical"
              />
              <Button
                type="submit"
                disabled={!matches || pending}
                className="bg-critical! text-white! hover:bg-critical/90! disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete customer"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                }}
              >
                Cancel
              </Button>
            </div>
            <div aria-live="assertive">
              {state.error && (
                <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">{state.error}</p>
              )}
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

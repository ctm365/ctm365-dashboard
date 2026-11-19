"use client";

import { useActionState } from "react";
import { createCustomer, type CreateCustomerState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { CUSTOMER_ID_MAX_LENGTH, CUSTOMER_ID_MIN_LENGTH, CUSTOMER_ID_RULE } from "@/lib/config/validation";

export function NewCustomerForm() {
  const [state, formAction, pending] = useActionState<CreateCustomerState, FormData>(createCustomer, {});

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="customerId" className="text-sm font-medium text-ink">
        Customer ID
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="customerId"
          name="customerId"
          required
          minLength={CUSTOMER_ID_MIN_LENGTH}
          maxLength={CUSTOMER_ID_MAX_LENGTH}
          defaultValue={state.customerId}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="customer-id-rule"
          aria-invalid={state.error ? true : undefined}
          placeholder="e.g. Mobile Modular"
          className="h-9 min-w-0 flex-1 basis-56 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus-visible:border-brand"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add customer"}
        </Button>
      </div>
      <p id="customer-id-rule" className="text-xs text-muted">
        {CUSTOMER_ID_RULE} Must match the user&apos;s <code>custom:customer_id</code> in Cognito exactly.
      </p>
      <div aria-live="assertive">
        {state.error && <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">{state.error}</p>}
      </div>
    </form>
  );
}

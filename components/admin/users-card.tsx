"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import {
  deleteCustomerUser,
  inviteCustomerUser,
  loadUsers,
  resendCustomerInvite,
  setCustomerUserEnabled,
  type UsersResult,
} from "@/app/admin/user-actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import type { CustomerUser, UserState } from "@/lib/users";

const STATE: Record<UserState, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-ok-soft text-ok" },
  invited: { label: "Invited, not signed in yet", className: "bg-sunken text-muted" },
  "invite-expired": { label: "Invite expired", className: "bg-watch-soft text-watch" },
  other: { label: "Needs attention", className: "bg-watch-soft text-watch" },
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", className)}>{children}</span>;
}

/**
 * The customer's sign-in accounts. Inviting creates the account and has
 * Cognito email a temporary password; the user picks their own at first sign-in.
 */
export function UsersCard({ customerId, currentUserSub }: { customerId: string; currentUserSub: string }) {
  const [users, setUsers] = useState<CustomerUser[] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<UsersResult>, success?: string, after?: () => void) {
    setError(undefined);
    setNotice(undefined);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUsers(result.users);
      if (success) setNotice(success);
      after?.();
    });
  }

  useEffect(() => {
    run(() => loadUsers(customerId));
    // Load once per customer.
  }, [customerId]);

  function onReview(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setConfirming(true);
  }

  const address = email.trim().toLowerCase();

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 border-b border-line pb-3">
        <CardTitle>Users</CardTitle>
        <p className="text-sm text-muted">
          People who can sign in to this customer&apos;s dashboard. They only ever see this customer&apos;s data.
        </p>
      </CardHeader>

      {users === null ? (
        <p className="px-5 py-4 text-sm text-muted">{error ? "Couldn't load users." : "Loading users…"}</p>
      ) : users.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No users yet. Invite someone below when you&apos;re ready.</p>
      ) : (
        <ul className="divide-y divide-line">
          {users.map((u) => {
            const self = u.username === currentUserSub;
            const canResend = u.state === "invited" || u.state === "invite-expired";
            return (
              <li key={u.username} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
                <span className="min-w-0 flex-1 basis-56 truncate text-sm font-medium text-ink" title={u.email}>
                  {u.email}
                  {self && <span className="font-normal text-muted"> (you)</span>}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {u.isAdmin && <Pill className="bg-brand/10 text-brand">Admin</Pill>}
                  {!u.enabled ? (
                    <Pill className="bg-critical-soft text-critical">Disabled</Pill>
                  ) : (
                    <Pill className={STATE[u.state].className}>{STATE[u.state].label}</Pill>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {canResend && u.enabled && (
                    <Button
                      variant="ghost"
                      className="h-8 px-3"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Email ${u.email} a new temporary password?`)) return;
                        run(() => resendCustomerInvite(customerId, u.username), `Invite resent to ${u.email}.`);
                      }}
                    >
                      Resend invite
                    </Button>
                  )}
                  {!self && (
                    <Button
                      variant="ghost"
                      className="h-8 px-3"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => setCustomerUserEnabled(customerId, u.username, !u.enabled),
                          u.enabled ? `${u.email} can no longer sign in.` : `${u.email} can sign in again.`,
                        )
                      }
                    >
                      {u.enabled ? "Disable" : "Enable"}
                    </Button>
                  )}
                  {!self && (
                    <Button
                      variant="ghost"
                      className="h-8 px-3 hover:text-critical"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Permanently delete ${u.email}'s sign-in account? This can't be undone.`)) return;
                        run(() => deleteCustomerUser(customerId, u.username), `Deleted ${u.email}.`);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
        {!confirming ? (
          <form onSubmit={onReview} className="flex flex-col gap-2">
            <label htmlFor="invite-email" className="text-sm font-medium text-ink">
              Invite a user
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="invite-email"
                type="email"
                required
                maxLength={254}
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                className="h-9 min-w-0 flex-1 basis-56 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus-visible:border-brand"
              />
              <Button type="submit" variant="secondary" disabled={pending || users === null}>
                Review invite…
              </Button>
            </div>
            <p className="text-xs text-muted">
              Nothing is sent until you confirm on the next step.
            </p>
          </form>
        ) : (
          <div className="flex flex-col gap-3 rounded-md bg-sunken px-4 py-3" role="group" aria-label="Confirm invite">
            <p className="text-sm text-ink">
              Send an invitation to <span className="font-medium">{address}</span>? They&apos;ll get an email with a
              temporary password that works for 7 days, and choose their own password at first sign-in. They&apos;ll
              only see <span className="font-medium">{customerId}</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() =>
                  run(
                    () => inviteCustomerUser(customerId, address),
                    `Invitation sent to ${address}.`,
                    () => {
                      setEmail("");
                      setConfirming(false);
                    },
                  )
                }
              >
                {pending ? "Sending…" : "Send invitation"}
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div aria-live="polite">
          {error && <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">{error}</p>}
          {notice && <p className="text-sm text-ok">{notice}</p>}
        </div>
      </div>
    </Card>
  );
}

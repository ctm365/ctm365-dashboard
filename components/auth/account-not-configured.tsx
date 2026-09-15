import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { SignOutButton } from "./sign-out-button";

export function AccountNotConfigured({ email, showAdminLink = false }: { email: string; showAdminLink?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4 pt-6">
          <span className="font-display text-xl font-semibold tracking-tight text-brand">CTM365</span>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-lg font-semibold text-ink">Account not configured</h1>
            <p className="text-sm text-muted">
              Your sign-in worked, but this account isn&apos;t linked to a customer yet. Contact your CTM365
              administrator.
            </p>
            {email && <p className="text-sm text-muted">Signed in as <span className="text-ink">{email}</span></p>}
          </div>
          <div className="flex items-center gap-4">
            <SignOutButton />
            {showAdminLink && (
              <Link href="/admin" className="text-sm font-medium text-brand hover:underline">
                Go to Admin
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

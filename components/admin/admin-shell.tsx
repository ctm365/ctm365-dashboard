import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";

/** Page chrome only. It does no auth checks; each admin page calls requireAdmin() itself. */
export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="font-display text-lg font-semibold tracking-tight text-brand">
              CTM365
            </Link>
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">Admin</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="text-sm font-medium text-brand hover:underline">
              Dashboard
            </Link>
            {email && (
              <span className="hidden max-w-[16rem] truncate text-sm text-muted md:inline" title={email}>
                {email}
              </span>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

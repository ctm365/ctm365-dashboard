import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/components/ui/cn";
import type { SERVICES } from "@/lib/services";
import type { ServiceId } from "@/lib/types";

type Tab = (typeof SERVICES)[number];

/**
 * Header for every customer page. Tabs appear only when the customer has
 * more than one service; a single-service customer never sees the other.
 */
export function SiteHeader({
  siteName,
  tabs,
  active,
  status,
  userEmail,
  showAdminLink,
}: {
  siteName: string;
  /** The customer's enabled services, in order. */
  tabs: readonly Tab[];
  active?: ServiceId;
  /** Page-specific status, e.g. the live connection on the Electrical page. */
  status?: ReactNode;
  userEmail: string;
  showAdminLink: boolean;
}) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-4">
          <img src="/ctm365-logo.png" alt="CTM365" className="h-18 w-auto" />
          <span className="truncate text-sm text-muted">{siteName}</span>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {status}
          <div className={cn("flex min-w-0 items-center gap-3", status && "border-l border-line pl-3")}>
            {showAdminLink && (
              <Link href="/admin" className="rounded px-1 text-sm font-medium text-brand hover:underline">
                Admin
              </Link>
            )}
            {userEmail && (
              <span className="hidden max-w-[16rem] truncate text-sm text-muted md:inline" title={userEmail}>
                {userEmail}
              </span>
            )}
            <SignOutButton />
          </div>
        </div>
      </div>

      {tabs.length > 1 && (
        <nav aria-label="Monitoring" className="mx-auto flex max-w-[1400px] gap-1 px-4 sm:px-6">
          {tabs.map((tab) => {
            const current = tab.id === active;
            return (
              <Link
                key={tab.id}
                href={tab.path}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
                  current ? "border-brand text-ink" : "border-transparent text-muted hover:border-line hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}

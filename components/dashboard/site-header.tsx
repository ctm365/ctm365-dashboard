"use client";

import Link from "next/link";
import type { ConnectionState } from "@/lib/live-fleet";
import { useLiveFleet } from "@/lib/live-fleet";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/components/ui/cn";
import { formatTime } from "./format";

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
};

export function SiteHeader({
  connection,
  lastUpdate,
  userEmail,
  showAdminLink,
}: {
  connection: ConnectionState;
  lastUpdate: number | null;
  userEmail: string;
  showAdminLink: boolean;
}) {
  const { site } = useLiveFleet();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-4">
             <img src="/ctm365-logo.png" alt="CTM365" className="h-18 w-auto" />
          <span className="truncate text-sm text-muted">{site.name}</span>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                connection === "live" ? "bg-ok" : connection === "reconnecting" ? "bg-watch" : "bg-line",
              )}
            />
            <span className="mr-2">{CONNECTION_TEXT[connection]}</span>
            {lastUpdate && (
              <span className="tabular hidden sm:inline">Updated {formatTime(lastUpdate)}</span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-3 border-l border-line pl-3">
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
    </header>
  );
}

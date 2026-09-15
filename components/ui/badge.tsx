import type { Status } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/fleet";
import { cn } from "./cn";

const TONE: Record<Status, string> = {
  normal: "bg-ok-soft text-ok",
  watch: "bg-watch-soft text-watch",
  critical: "bg-critical-soft text-critical",
};

const DOT: Record<Status, string> = {
  normal: "bg-ok",
  watch: "bg-watch",
  critical: "bg-critical",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        TONE[status],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

import { Card } from "@/components/ui/card";

/** A page-sized message for when there is nothing to show yet. */
export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="font-display text-lg font-semibold text-ink">{title}</h1>
      <p className="max-w-prose text-sm text-muted">{children}</p>
    </Card>
  );
}

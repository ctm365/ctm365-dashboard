import { Button } from "@/components/ui/button";

/** Plain form POST, so it works before hydration and needs no client state. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/api/auth/logout" method="post" className={className}>
      <Button type="submit" variant="secondary" className="h-8 px-3">
        Sign out
      </Button>
    </form>
  );
}

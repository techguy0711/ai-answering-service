import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";

export function Topbar({ email }: { email: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{email}</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}

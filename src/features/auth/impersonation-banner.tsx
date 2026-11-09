import { Button } from "@/components/ui/button";
import { exitImpersonationAction } from "./actions";

/** Shown on every page while a superadmin views the application as another account. */
export function ImpersonationBanner({ viewing, roleLabel, by }: { viewing: string; roleLabel: string; by: string }) {
  return (
    <div role="status" data-testid="impersonation-banner" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning px-4 py-2 text-sm text-warning-foreground">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">
          Anda melihat sebagai {viewing} ({roleLabel}).
        </span>{" "}
        Hanya lihat: perubahan tidak disimpan. Dibuka oleh {by}, berlaku 1 jam.
      </p>
      <form action={exitImpersonationAction}>
        <Button type="submit" size="sm" variant="outline">
          Keluar dari mode ini
        </Button>
      </form>
    </div>
  );
}

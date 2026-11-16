import { Button } from "@/components/ui/button";
import { exitImpersonationAction } from "./actions";

/** Shown on every page while a superadmin works in the application as another account. */
export function ImpersonationBanner({ viewing, roleLabel, by }: { viewing: string; roleLabel: string; by: string }) {
  return (
    <div role="status" data-testid="impersonation-banner" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning px-4 py-2 text-sm text-warning-foreground">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">
          Anda masuk sebagai {viewing} ({roleLabel}).
        </span>{" "}
        Perubahan yang Anda buat tersimpan atas nama akun ini. Dibuka oleh {by}, berlaku 1 jam.
      </p>
      <form action={exitImpersonationAction}>
        <Button type="submit" size="sm" variant="outline">
          Keluar dari mode ini
        </Button>
      </form>
    </div>
  );
}

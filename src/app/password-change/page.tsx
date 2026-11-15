import { Suspense } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/app-shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME } from "@/config/app";
import { ChangePasswordForm } from "@/features/account/change-password-form";
import { logoutAction } from "@/features/auth/actions";
import { requireUser } from "@/server/auth/current-user";

/**
 * The gate an account passes through when somebody else chose its password: an account an administrator created or reset, and the
 * first superadmin (T-9). `requireUser` sends every other page here while the flag is set, so nothing of the application can be
 * reached with a password that was handed over. It sits outside the (app) group, so it has no menu to wander off into.
 */
export default function PasswordChangePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-gradient-to-b from-accent/60 to-background px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="h-12" priority />
          <h1 className="sr-only">{APP_NAME}</h1>
        </div>
        <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Memuat halaman…</p>}>
          <ChoosePassword />
        </Suspense>
      </div>
    </main>
  );
}

async function ChoosePassword() {
  // This page is the one place a user with the flag may be, so it asks for the sign-in without the redirect that guards the rest.
  const user = await requireUser({ allowPasswordChange: true });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <h2>Ganti kata sandi bawaan Anda</h2>
        </CardTitle>
        <CardDescription>
          Akun {user.email} masih memakai kata sandi bawaan dari administrator. Ganti dengan kata sandi baru yang hanya Anda yang tahu, lalu {APP_NAME} bisa dipakai.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ChangePasswordForm />
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
            Continue
          </Link>
          <form action={logoutAction} className="ml-auto">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

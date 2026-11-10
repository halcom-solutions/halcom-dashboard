import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/app-shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME, APP_TAGLINE } from "@/config/app";
import { homePathFor } from "@/domain/access/dashboards";
import { ROLE_LABELS } from "@/domain/access/roles";
import { forgetAllRecentAccountsAction, forgetRecentAccountAction, forgetRememberedAccountAction, switchToRememberedAction } from "@/features/auth/actions";
import { LoginForm } from "@/features/auth/login-form";
import { getCurrentUser } from "@/server/auth/current-user";
import { readRememberedAccounts, type RememberedAccount } from "@/server/auth/device-accounts";
import { readRecentAccounts } from "@/server/auth/recent-accounts";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-gradient-to-b from-accent/60 to-background px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="h-12" priority />
          <h1 className="sr-only">{APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
        </div>
        {/* Reads the recent-accounts cookie and the query string, so it streams in behind Suspense. */}
        <Suspense fallback={<SignInCard accounts={[]} remembered={[]} chosen="" />}>
          <SignIn searchParams={searchParams} />
        </Suspense>
        <Link href="/privacy" className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
          Privacy statement
        </Link>
      </div>
      {/* Signed-in users skip the form. This reads the session, so it streams in behind Suspense. */}
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
    </main>
  );
}

async function SignIn({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const query = await searchParams;
  // Accounts remembered on this browser are offered without a password only while switching, never after a plain sign-out.
  const remembered = query.switch === "1" ? await readRememberedAccounts() : [];
  const rememberedEmails = new Set(remembered.map((account) => account.email));
  const accounts = (await readRecentAccounts()).filter((account) => !rememberedEmails.has(account.email));
  const wanted = query.account;
  // Only an account this browser has really used can be preselected; anything else in the URL is ignored.
  const chosen = typeof wanted === "string" ? (accounts.find((account) => account.email === wanted.trim().toLowerCase())?.email ?? "") : "";
  return <SignInCard accounts={accounts} remembered={remembered} chosen={chosen} />;
}

function SignInCard({ accounts, remembered, chosen }: { accounts: Awaited<ReturnType<typeof readRecentAccounts>>; remembered: RememberedAccount[]; chosen: string }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Gunakan akun {APP_NAME} Anda.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* A new key rebuilds the form when another account is picked, so its email box shows the choice. */}
          <LoginForm key={chosen} defaultEmail={chosen} />
        </CardContent>
      </Card>
      {remembered.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Switch account</h2>
            </CardTitle>
            <CardDescription>Akun yang diingat di browser ini. Pilih satu untuk masuk tanpa kata sandi.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul aria-label="Remembered accounts" className="flex flex-col gap-2">
              {remembered.map((account) => (
                <li key={account.credentialId} className="flex items-center gap-2">
                  <form action={switchToRememberedAction} className="min-w-0 flex-1">
                    <input type="hidden" name="credentialId" value={account.credentialId} />
                    <button type="submit" className="w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="block truncate font-medium">Continue as {account.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {account.email} · {ROLE_LABELS[account.role]}
                      </span>
                    </button>
                  </form>
                  <form action={forgetRememberedAccountAction}>
                    <input type="hidden" name="credentialId" value={account.credentialId} />
                    <Button type="submit" variant="ghost" size="sm" aria-label={`Forget account ${account.email} on this browser`}>
                      Forget account
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={forgetAllRecentAccountsAction} className="mt-3">
              <Button type="submit" variant="outline" size="sm">
                Forget all accounts on this browser
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {accounts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Recent accounts</h2>
            </CardTitle>
            <CardDescription>Akun lain di browser ini. Pilih satu untuk mengisi emailnya; kata sandi tetap perlu diketik.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {accounts.map((account) => (
                <li key={account.email} className="flex items-center gap-2">
                  <a
                    href={`/login?account=${encodeURIComponent(account.email)}`}
                    aria-current={account.email === chosen ? "true" : undefined}
                    className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm hover:bg-muted aria-[current=true]:border-primary"
                  >
                    <span className="block truncate font-medium">{account.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {account.email} · {ROLE_LABELS[account.role]}
                    </span>
                  </a>
                  <form action={forgetRecentAccountAction}>
                    <input type="hidden" name="email" value={account.email} />
                    <Button type="submit" variant="ghost" size="sm" aria-label={`Remove from list ${account.email}`}>
                      Remove from list
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            {remembered.length === 0 ? (
              <form action={forgetAllRecentAccountsAction}>
                <Button type="submit" variant="outline" size="sm">
                  Forget all accounts on this browser
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

async function RedirectIfSignedIn() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role));
  return null;
}

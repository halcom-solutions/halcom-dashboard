import { Suspense } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { can } from "@/domain/access/permissions";
import { ROLE_LABELS } from "@/domain/access/roles";
import { logoutAction, switchAccountAction } from "@/features/auth/actions";
import { ImpersonationBanner } from "@/features/auth/impersonation-banner";
import { SessionKeepAlive } from "@/features/auth/session-keep-alive";
import { ACCOUNT_PATH, GUIDE_PATH, NOTIFICATIONS_PATH, navSectionsFor } from "@/features/navigation/links";
import { ThemeSwitcher } from "@/features/theme/theme-switcher";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { countUnreadBySeverity } from "@/server/notifications/service";

// Every page under (app) is per-user and needs a live session check (a deactivated
// user must lose access immediately, so the session cannot be cached ahead of time).
// Navigations into this segment therefore block on the server, and instant-navigation
// validation, which renders without a session, cannot succeed here.
export const instant = false;

// Everything under (app) needs a signed-in user. The session is read at request
// time, so the authenticated shell streams in behind this Suspense boundary.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Memuat halaman…</p>}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unreadBySeverity = await countUnreadBySeverity(getDb(), user.id);
  const unread = unreadBySeverity.INFO + unreadBySeverity.WARNING + unreadBySeverity.DANGER;

  return (
    <AppShell
      sections={navSectionsFor(user.role, user.alsoManagement)}
      user={{ name: user.name, roleLabel: ROLE_LABELS[user.role] }}
      accountHref={ACCOUNT_PATH}
      notifications={{ href: NOTIFICATIONS_PATH, unread, bySeverity: unreadBySeverity }}
      guideHref={GUIDE_PATH}
      controls={can(user.role, "theme.switch") ? <ThemeSwitcher /> : null}
      signOut={
        <div className="flex flex-col gap-2">
          {/* Ends this session, then shows the sign-in page with the accounts used on this browser. */}
          <form action={switchAccountAction}>
            <Button type="submit" variant="outline" className="w-full">
              Switch account
            </Button>
          </form>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      }
    >
      {user.impersonatedBy ? <ImpersonationBanner viewing={user.name} roleLabel={ROLE_LABELS[user.role]} by={user.impersonatedBy.name} /> : <SessionKeepAlive />}
      {children}
    </AppShell>
  );
}
